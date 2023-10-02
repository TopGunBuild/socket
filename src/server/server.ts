import { JwtSecret } from '@topgunbuild/jsonwebtoken';
import { AsyncStreamEmitter } from '@topgunbuild/async-stream-emitter';
import { uuidv4 } from '../utils/uuidv4';
import { generateId } from '../utils/generate-id';
import {
    AuthTokenError,
    AuthTokenExpiredError,
    AuthTokenInvalidError, AuthTokenNotBeforeError, BrokerError, dehydrateError,
    InvalidActionError, InvalidArgumentsError,
    InvalidOptionsError,
    ServerProtocolError, SilentMiddlewareBlockedError
} from '../errors';
import { randomBytes } from '../utils/random-bytes';
import { AuthEngine } from '../auth';
import * as formatter from '../formatter';
import { TGSocket } from './socket';
import {
    AuthEngineType,
    AuthState,
    AuthToken,
    CodecEngine,
    EventObject,
    MiddlewareFunction,
    Middlewares
} from '../types';
import { applyEachSeries, AsyncFunction } from '../utils/apply-each-series';
import { IncomingMessage, RequestObject, TGServerChannelOptions, TGSocketServerOptions } from './types';
import { SimpleBroker } from '../simple-broker/simple-broker';
import { isNode } from '../utils/is-node';
import { SimpleExchange } from '../simple-broker';

/* eslint-disable @typescript-eslint/no-unused-vars */
export class TGSocketServer extends AsyncStreamEmitter<any>
{
    options: TGSocketServerOptions;
    MIDDLEWARE_HANDSHAKE_WS: Middlewares;
    MIDDLEWARE_HANDSHAKE_AG: Middlewares;
    MIDDLEWARE_TRANSMIT: Middlewares;
    MIDDLEWARE_INVOKE: Middlewares;
    MIDDLEWARE_SUBSCRIBE: Middlewares;
    MIDDLEWARE_PUBLISH_IN: Middlewares;
    MIDDLEWARE_PUBLISH_OUT: Middlewares;
    MIDDLEWARE_AUTHENTICATE: Middlewares;

    origins: string;
    ackTimeout: number;
    handshakeTimeout: number;
    pingInterval: number;
    pingTimeout: number;
    pingTimeoutDisabled: boolean;
    allowClientPublish: boolean;
    perMessageDeflate: boolean|object;
    httpServer: any;
    socketChannelLimit: number;
    brokerEngine: SimpleBroker;
    appName: string;
    middlewareEmitWarnings: boolean;
    isReady: boolean;
    signatureKey: JwtSecret;
    verificationKey: JwtSecret;
    authVerifyAsync: boolean;
    authSignAsync: boolean;
    defaultVerificationOptions: any;
    defaultSignatureOptions: any;
    auth: AuthEngineType;
    codec: CodecEngine;
    clients: {
        [id: string]: TGSocket
    };
    clientsCount: number;
    pendingClients: {
        [id: string]: TGSocket
    };
    pendingClientsCount: number;
    exchange: SimpleExchange;

    private readonly _middleware: {[key: string]: AsyncFunction[]};
    private readonly _allowAllOrigins: boolean;
    private readonly wsServer: any;
    private readonly _path: string;

    /**
     * Constructor
     */
    constructor(options: TGSocketServerOptions)
    {
        super();

        const opts: TGSocketServerOptions = {
            brokerEngine          : new SimpleBroker(),
            wsEngine              : 'ws',
            wsEngineServerOptions : {},
            maxPayload            : null,
            allowClientPublish    : true,
            ackTimeout            : 10000,
            handshakeTimeout      : 10000,
            pingTimeout           : 20000,
            pingTimeoutDisabled   : false,
            pingInterval          : 8000,
            origins               : '*:*',
            appName               : uuidv4(),
            path                  : '/topgunsocket/',
            authDefaultExpiry     : 86400,
            authSignAsync         : false,
            authVerifyAsync       : true,
            pubSubBatchDuration   : null,
            middlewareEmitWarnings: true
        };

        this.options = Object.assign(opts, options || {});

        this.MIDDLEWARE_HANDSHAKE_WS = 'handshakeWS';
        this.MIDDLEWARE_HANDSHAKE_AG = 'handshakeAG';
        this.MIDDLEWARE_TRANSMIT     = 'transmit';
        this.MIDDLEWARE_INVOKE       = 'invoke';
        this.MIDDLEWARE_SUBSCRIBE    = 'subscribe';
        this.MIDDLEWARE_PUBLISH_IN   = 'publishIn';
        this.MIDDLEWARE_PUBLISH_OUT  = 'publishOut';
        this.MIDDLEWARE_AUTHENTICATE = 'authenticate';

        this._middleware                               = {};
        this._middleware[this.MIDDLEWARE_HANDSHAKE_WS] = [];
        this._middleware[this.MIDDLEWARE_HANDSHAKE_AG] = [];
        this._middleware[this.MIDDLEWARE_TRANSMIT]     = [];
        this._middleware[this.MIDDLEWARE_INVOKE]       = [];
        this._middleware[this.MIDDLEWARE_SUBSCRIBE]    = [];
        this._middleware[this.MIDDLEWARE_PUBLISH_IN]   = [];
        this._middleware[this.MIDDLEWARE_PUBLISH_OUT]  = [];
        this._middleware[this.MIDDLEWARE_AUTHENTICATE] = [];

        this.origins          = opts.origins;
        this._allowAllOrigins = this.origins.indexOf('*:*') !== -1;

        this.ackTimeout          = opts.ackTimeout;
        this.handshakeTimeout    = opts.handshakeTimeout;
        this.pingInterval        = opts.pingInterval;
        this.pingTimeout         = opts.pingTimeout;
        this.pingTimeoutDisabled = opts.pingTimeoutDisabled;
        this.allowClientPublish  = opts.allowClientPublish;
        this.perMessageDeflate   = opts.perMessageDeflate;
        this.httpServer          = opts.httpServer;
        this.socketChannelLimit  = opts.socketChannelLimit;

        this.brokerEngine           = opts.brokerEngine;
        this.appName                = opts.appName || '';
        this.middlewareEmitWarnings = opts.middlewareEmitWarnings;

        // Make sure there is always a leading and a trailing slash in the WS path.
        this._path = opts.path.replace(/\/?$/, '/').replace(/^\/?/, '/');

        if (this.brokerEngine.isReady)
        {
            this.isReady = true;
            this.emit('ready', {});
        }
        else
        {
            this.isReady = false;
            (async () =>
            {
                await this.brokerEngine.listener('ready').once();
                this.isReady = true;
                this.emit('ready', {});
            })();
        }

        if (opts.authPrivateKey != null || opts.authPublicKey != null)
        {
            if (opts.authPrivateKey == null)
            {
                throw new InvalidOptionsError(
                    'The authPrivateKey option must be specified if authPublicKey is specified'
                );
            }
            else if (opts.authPublicKey == null)
            {
                throw new InvalidOptionsError(
                    'The authPublicKey option must be specified if authPrivateKey is specified'
                );
            }
            this.signatureKey    = opts.authPrivateKey;
            this.verificationKey = opts.authPublicKey;
        }
        else
        {
            if (opts.authKey == null)
            {
                opts.authKey = randomBytes(32);
            }
            this.signatureKey    = opts.authKey;
            this.verificationKey = opts.authKey;
        }

        this.authVerifyAsync = opts.authVerifyAsync;
        this.authSignAsync   = opts.authSignAsync;

        this.defaultVerificationOptions = {
            async: this.authVerifyAsync
        };
        if (opts.authVerifyAlgorithms != null)
        {
            this.defaultVerificationOptions.algorithms = opts.authVerifyAlgorithms;
        }
        else if (opts.authAlgorithm != null)
        {
            this.defaultVerificationOptions.algorithms = [opts.authAlgorithm];
        }

        this.defaultSignatureOptions = {
            expiresIn: opts.authDefaultExpiry,
            async    : this.authSignAsync
        };
        if (opts.authAlgorithm != null)
        {
            this.defaultSignatureOptions.algorithm = opts.authAlgorithm;
        }

        if (opts.authEngine)
        {
            this.auth = opts.authEngine;
        }
        else
        {
            // Default authentication engine
            this.auth = new AuthEngine();
        }

        if (opts.codecEngine)
        {
            this.codec = opts.codecEngine;
        }
        else
        {
            // Default codec engine
            this.codec = formatter;
        }

        this.clients      = {};
        this.clientsCount = 0;

        this.pendingClients      = {};
        this.pendingClientsCount = 0;

        this.exchange = this.brokerEngine.exchange();

        const wsServerOptions        = opts.wsEngineServerOptions || {};
        wsServerOptions.server       = this.httpServer;
        wsServerOptions.verifyClient = this.verifyHandshake.bind(this);

        if (wsServerOptions.path == null && this._path != null)
        {
            wsServerOptions.path = this._path;
        }
        if (wsServerOptions.perMessageDeflate == null && this.perMessageDeflate != null)
        {
            wsServerOptions.perMessageDeflate = this.perMessageDeflate;
        }
        if (wsServerOptions.handleProtocols == null && opts.handleProtocols != null)
        {
            wsServerOptions.handleProtocols = opts.handleProtocols;
        }
        if (wsServerOptions.maxPayload == null && opts.maxPayload != null)
        {
            wsServerOptions.maxPayload = opts.maxPayload;
        }
        if (wsServerOptions.clientTracking == null)
        {
            wsServerOptions.clientTracking = false;
        }

        if (isNode())
        {
            const wsEngine = typeof opts.wsEngine === 'string' ? require(opts.wsEngine) : opts.wsEngine;
            if (!wsEngine || !wsEngine.Server)
            {
                throw new InvalidOptionsError(
                    'The wsEngine option must be a path or module name which points ' +
                    'to a valid WebSocket engine module with a compatible interface'
                );
            }
            const WSServer = wsEngine.Server;

            this.wsServer = new WSServer(wsServerOptions);
            this.wsServer.on('error', this._handleServerError.bind(this));
            this.wsServer.on('connection', this.handleSocketConnection.bind(this));
        }
    }

    handleSocketConnection(wsSocket: WebSocket, upgradeReq?: any): void
    {
        if (!wsSocket['upgradeReq'] && upgradeReq)
        {
            // Normalize ws modules to match.
            wsSocket['upgradeReq'] = upgradeReq;
        }

        const id = this.generateId();

        const scSocket    = new TGSocket(id, this, wsSocket);
        scSocket.exchange = this.exchange;

        this._handleSocketErrors(scSocket);

        this.pendingClients[id] = scSocket;
        this.pendingClientsCount++;

        const handleSocketAuthenticate = async () =>
        {
            for await (const rpc of scSocket.procedure('#authenticate'))
            {
                const signedAuthToken = rpc.data;

                this._processAuthToken(scSocket, signedAuthToken, (err, isBadToken, oldAuthState) =>
                {
                    if (err)
                    {
                        if (isBadToken)
                        {
                            scSocket.deauthenticate();
                        }
                    }
                    else
                    {
                        scSocket.triggerAuthenticationEvents(oldAuthState);
                    }
                    if (err && isBadToken)
                    {
                        rpc.error(err);
                    }
                    else
                    {
                        const authStatus = {
                            isAuthenticated: !!scSocket.authToken,
                            authError      : dehydrateError(err)
                        };
                        rpc.end(authStatus);
                    }
                });
            }
        };
        handleSocketAuthenticate();

        const handleSocketRemoveAuthToken = async () =>
        {
            for await (const data of scSocket.receiver('#removeAuthToken'))
            {
                scSocket.deauthenticateSelf();
            }
        };
        handleSocketRemoveAuthToken();

        const handleSocketSubscribe = async () =>
        {
            for await (const rpc of scSocket.procedure('#subscribe'))
            {
                let channelOptions = rpc.data;

                if (!channelOptions)
                {
                    channelOptions = {};
                }
                else if (typeof channelOptions === 'string')
                {
                    channelOptions = {
                        channel: channelOptions
                    };
                }

                (async () =>
                {
                    if (scSocket.state === scSocket.OPEN)
                    {
                        try
                        {
                            await this._subscribeSocket(scSocket, channelOptions);
                        }
                        catch (err)
                        {
                            const error = new BrokerError(`Failed to subscribe socket to the ${channelOptions.channel} channel - ${err}`);
                            rpc.error(error);
                            scSocket.emitError(error);
                            return;
                        }
                        if (channelOptions.batch)
                        {
                            rpc.end(undefined, { batch: true });
                            return;
                        }
                        rpc.end();
                        return;
                    }
                    // This is an invalid state; it means the client tried to subscribe before
                    // having completed the handshake.
                    const error = new InvalidActionError('Cannot subscribe socket to a channel before it has completed the handshake');
                    rpc.error(error);
                    this.emitWarning(error);
                })();
            }
        };
        handleSocketSubscribe();

        const handleSocketUnsubscribe = async () =>
        {
            for await (const rpc of scSocket.procedure('#unsubscribe'))
            {
                const channel = rpc.data;
                let error;
                try
                {
                    this._unsubscribeSocket(scSocket, channel);
                }
                catch (err)
                {
                    error = new BrokerError(
                        `Failed to unsubscribe socket from the ${channel} channel - ${err}`
                    );
                }
                if (error)
                {
                    rpc.error(error);
                    scSocket.emitError(error);
                }
                else
                {
                    rpc.end();
                }
            }
        };
        handleSocketUnsubscribe();

        const cleanupSocket = (type, code, reason) =>
        {
            clearTimeout(scSocket._handshakeTimeoutRef);

            scSocket.closeProcedure('#handshake');
            scSocket.closeProcedure('#authenticate');
            scSocket.closeProcedure('#subscribe');
            scSocket.closeProcedure('#unsubscribe');
            scSocket.closeReceiver('#removeAuthToken');
            scSocket.closeListener('authenticate');
            scSocket.closeListener('authStateChange');
            scSocket.closeListener('deauthenticate');

            const isClientFullyConnected = !!this.clients[id];

            if (isClientFullyConnected)
            {
                delete this.clients[id];
                this.clientsCount--;
            }

            const isClientPending = !!this.pendingClients[id];
            if (isClientPending)
            {
                delete this.pendingClients[id];
                this.pendingClientsCount--;
            }

            if (type === 'disconnect')
            {
                this.emit('disconnection', {
                    socket: scSocket,
                    code,
                    reason
                });
            }
            else if (type === 'abort')
            {
                this.emit('connectionAbort', {
                    socket: scSocket,
                    code,
                    reason
                });
            }
            this.emit('closure', {
                socket: scSocket,
                code,
                reason
            });

            this._unsubscribeSocketFromAllChannels(scSocket);
        };

        const handleSocketDisconnect = async () =>
        {
            const event = await scSocket.listener('disconnect').once();
            cleanupSocket('disconnect', event.code, event.data);
        };
        handleSocketDisconnect();

        const handleSocketAbort = async () =>
        {
            const event = await scSocket.listener('connectAbort').once();
            cleanupSocket('abort', event.code, event.data);
        };
        handleSocketAbort();

        scSocket._handshakeTimeoutRef = setTimeout(this._handleHandshakeTimeout.bind(this, scSocket), this.handshakeTimeout);

        const handleSocketHandshake = async () =>
        {
            for await (const rpc of scSocket.procedure('#handshake'))
            {
                const data            = rpc.data || {};
                const signedAuthToken = data.authToken || null;
                clearTimeout(scSocket._handshakeTimeoutRef);

                this._passThroughHandshakeAGMiddleware({
                    socket: scSocket
                }, (err: any, statusCode: number) =>
                {
                    if (err)
                    {
                        if (err.statusCode == null)
                        {
                            err.statusCode = statusCode;
                        }
                        rpc.error(err);
                        scSocket.disconnect(err.statusCode);
                        return;
                    }
                    this._processAuthToken(scSocket, signedAuthToken, (err, isBadToken, oldAuthState) =>
                    {
                        if (scSocket.state === scSocket.CLOSED)
                        {
                            return;
                        }

                        const clientSocketStatus: EventObject = {
                            id         : scSocket.id,
                            pingTimeout: this.pingTimeout
                        };
                        const serverSocketStatus: EventObject = {
                            id         : scSocket.id,
                            pingTimeout: this.pingTimeout
                        };

                        if (err)
                        {
                            if (signedAuthToken != null)
                            {
                                // Because the token is optional as part of the handshake, we don't count
                                // it as an error if the token wasn't provided.
                                clientSocketStatus.authError = dehydrateError(err);
                                serverSocketStatus.authError = err;

                                if (isBadToken)
                                {
                                    scSocket.deauthenticate();
                                }
                            }
                        }
                        clientSocketStatus.isAuthenticated = !!scSocket.authToken;
                        serverSocketStatus.isAuthenticated = clientSocketStatus.isAuthenticated;

                        if (this.pendingClients[id])
                        {
                            delete this.pendingClients[id];
                            this.pendingClientsCount--;
                        }
                        this.clients[id] = scSocket;
                        this.clientsCount++;

                        scSocket.state = scSocket.OPEN;

                        if (clientSocketStatus.isAuthenticated)
                        {
                            // Needs to be executed after the connection event to allow
                            // consumers to be setup from inside the connection loop.
                            (async () =>
                            {
                                await this.listener('connection').once();
                                scSocket.triggerAuthenticationEvents(oldAuthState);
                            })();
                        }

                        scSocket.emit('connect', serverSocketStatus);
                        this.emit('connection', { socket: scSocket, ...serverSocketStatus });

                        // Treat authentication failure as a 'soft' error
                        rpc.end(clientSocketStatus);
                    });
                });
            }
        };
        handleSocketHandshake();

        // Emit event to signal that a socket handshake has been initiated.
        this.emit('handshake', { socket: scSocket });
    }

    setAuthEngine(authEngine: AuthEngineType): void
    {
        this.auth = authEngine;
    }

    setCodecEngine(codecEngine: CodecEngine): void
    {
        this.codec = codecEngine;
    }

    emitError(error: Error): void
    {
        this.emit('error', { error });
    }

    emitWarning(warning: Error): void
    {
        this.emit('warning', { warning });
    }

    close(keepSocketsOpen?: boolean): Promise<void>
    {
        this.isReady = false;
        return new Promise((resolve, reject) =>
        {
            if (isNode())
            {
                this.wsServer.close((err: any) =>
                {
                    if (err)
                    {
                        reject(err);
                        return;
                    }
                    resolve();
                });

                if (!keepSocketsOpen)
                {
                    for (const socket of Object.values(this.clients))
                    {
                        socket.terminate();
                    }
                }
            }
            else
            {
                for (const socket of Object.values(this.clients))
                {
                    socket.disconnect(1011, 'WebSocket broken.')
                }
            }
        });
    }

    getPath(): string
    {
        return this._path;
    };

    generateId(): string
    {
        return generateId();
    };

    addMiddleware(type: Middlewares, middleware: MiddlewareFunction): void
    {
        if (!this._middleware[type])
        {
            throw new InvalidArgumentsError(`Middleware type "${type}" is not supported`);
            // Read more: https://socketcluster.io/#!/docs/middleware-and-authorization
        }
        this._middleware[type].push(middleware);
    };

    removeMiddleware(type: Middlewares, middleware: MiddlewareFunction): void
    {
        const middlewareFunctions = this._middleware[type];

        this._middleware[type] = middlewareFunctions.filter((fn) =>
        {
            return fn !== middleware;
        });
    };

    async verifyHandshake(
        info: {origin?: string; secure?: boolean; req?: IncomingMessage},
        callback: (res: boolean, code?: number, message?: string, headers?: any) => void
    ): Promise<void>
    {
        const req  = info.req;
        let origin = info.origin;
        if (origin === 'null' || origin == null)
        {
            origin = '*';
        }
        let ok: boolean|number = false;

        if (this._allowAllOrigins)
        {
            ok = true;
        }
        else
        {
            try
            {
                const parser = new URL(origin);
                const port   =
                          parser.port || (parser.protocol === 'https:' ? 443 : 80);
                ok           =
                    ~this.origins.indexOf(parser.hostname + ':' + port) ||
                    ~this.origins.indexOf(parser.hostname + ':*') ||
                    ~this.origins.indexOf('*:' + port);
            }
            catch (e)
            {
            }
        }

        if (ok)
        {
            const handshakeMiddleware = this._middleware[this.MIDDLEWARE_HANDSHAKE_WS];
            if (handshakeMiddleware.length)
            {
                let callbackInvoked = false;
                await applyEachSeries(handshakeMiddleware, req, (err) =>
                {
                    if (callbackInvoked)
                    {
                        this.emitWarning(
                            new InvalidActionError(
                                `Callback for ${this.MIDDLEWARE_HANDSHAKE_WS} middleware was already invoked`
                            )
                        );
                    }
                    else
                    {
                        callbackInvoked = true;
                        if (err)
                        {
                            if (err === true || err.silent)
                            {
                                err = new SilentMiddlewareBlockedError(
                                    `Action was silently blocked by ${this.MIDDLEWARE_HANDSHAKE_WS} middleware`,
                                    this.MIDDLEWARE_HANDSHAKE_WS
                                );
                            }
                            else if (this.middlewareEmitWarnings)
                            {
                                this.emitWarning(err);
                            }
                            callback(false, 401, typeof err === 'string' ? err : err.message);
                        }
                        else
                        {
                            callback(true);
                        }
                    }
                });
            }
            else
            {
                callback(true);
            }
        }
        else
        {
            const err = new ServerProtocolError(
                `Failed to authorize socket handshake - Invalid origin: ${origin}`
            );
            this.emitWarning(err);
            callback(false, 403, err.message);
        }
    }

    verifyInboundRemoteEvent(requestOptions, callback: (err: Error, newEventData?: any, ackData?: any) => any): void
    {
        const socket = requestOptions.socket;
        const token  = socket.getAuthToken();
        if (this.isAuthTokenExpired(token))
        {
            requestOptions.authTokenExpiredError = new AuthTokenExpiredError(
                'The socket auth token has expired',
                token.exp
            );

            socket.deauthenticate();
        }

        this._passThroughMiddleware(requestOptions, callback);
    }

    isAuthTokenExpired(token: AuthToken): boolean
    {
        if (token && token.exp != null)
        {
            const currentTime        = Date.now();
            const expiryMilliseconds = token.exp * 1000;
            return currentTime > expiryMilliseconds;
        }
        return false;
    }

    async verifyOutboundEvent(
        socket: any,
        eventName: string,
        eventData: any,
        options: any,
        callback: (err: Error, data?: any) => any
    ): Promise<void>
    {
        let callbackInvoked = false;

        if (eventName === '#publish')
        {
            const request: EventObject = {
                socket : socket,
                channel: eventData.channel,
                data   : eventData.data
            };
            await applyEachSeries(this._middleware[this.MIDDLEWARE_PUBLISH_OUT], request,
                (err) =>
                {
                    if (callbackInvoked)
                    {
                        this.emitWarning(
                            new InvalidActionError(
                                `Callback for ${this.MIDDLEWARE_PUBLISH_OUT} middleware was already invoked`
                            )
                        );
                    }
                    else
                    {
                        callbackInvoked = true;
                        if (request.data !== undefined)
                        {
                            eventData.data = request.data;
                        }
                        if (err)
                        {
                            if (err === true || err.silent)
                            {
                                err = new SilentMiddlewareBlockedError(
                                    `Action was silently blocked by ${this.MIDDLEWARE_PUBLISH_OUT} middleware`,
                                    this.MIDDLEWARE_PUBLISH_OUT
                                );
                            }
                            else if (this.middlewareEmitWarnings)
                            {
                                this.emitWarning(err);
                            }
                            callback(err, eventData);
                        }
                        else
                        {
                            if (options && request.useCache)
                            {
                                options.useCache = true;
                            }
                            callback(null, eventData);
                        }
                    }
                }
            );
        }
        else
        {
            callback(null, eventData);
        }
    }

    // -----------------------------------------------------------------------------------------------------
    // @ Private methods
    // -----------------------------------------------------------------------------------------------------

    private async _processSubscribeAction(
        options: EventObject,
        request: RequestObject,
        callback: (err: Error, data?: any) => any
    ): Promise<void>
    {
        let callbackInvoked = false;

        const eventData     = options.data || {};
        request.channel     = eventData.channel;
        request.waitForAuth = eventData.waitForAuth;
        request.data        = eventData.data;

        if (request.waitForAuth && request.authTokenExpiredError)
        {
            // If the channel has the waitForAuth flag set, then we will handle the expiry quietly
            // and we won't pass this request through the subscribe middleware.
            callback(request.authTokenExpiredError, eventData);
        }
        else
        {
            await applyEachSeries(this._middleware[this.MIDDLEWARE_SUBSCRIBE], request,
                (err) =>
                {
                    if (callbackInvoked)
                    {
                        this.emitWarning(
                            new InvalidActionError(
                                `Callback for ${this.MIDDLEWARE_SUBSCRIBE} middleware was already invoked`
                            )
                        );
                    }
                    else
                    {
                        callbackInvoked = true;
                        if (err)
                        {
                            if (err === true || err.silent)
                            {
                                err = new SilentMiddlewareBlockedError(
                                    `Action was silently blocked by ${this.MIDDLEWARE_SUBSCRIBE} middleware`,
                                    this.MIDDLEWARE_SUBSCRIBE
                                );
                            }
                            else if (this.middlewareEmitWarnings)
                            {
                                this.emitWarning(err);
                            }
                        }
                        if (request.data !== undefined)
                        {
                            eventData.data = request.data;
                        }
                        callback(err, eventData);
                    }
                }
            );
        }
    }

    private async _processTransmitAction(
        options: EventObject,
        request: RequestObject,
        callback: (err: Error, eventData: any, data?: any) => any
    ): Promise<void>
    {
        let callbackInvoked = false;

        request.event = options.event;
        request.data  = options.data;

        await applyEachSeries(this._middleware[this.MIDDLEWARE_TRANSMIT], request,
            (err) =>
            {
                if (callbackInvoked)
                {
                    this.emitWarning(
                        new InvalidActionError(
                            `Callback for ${this.MIDDLEWARE_TRANSMIT} middleware was already invoked`
                        )
                    );
                }
                else
                {
                    callbackInvoked = true;
                    if (err)
                    {
                        if (err === true || err.silent)
                        {
                            err = new SilentMiddlewareBlockedError(
                                `Action was silently blocked by ${this.MIDDLEWARE_TRANSMIT} middleware`,
                                this.MIDDLEWARE_TRANSMIT
                            );
                        }
                        else if (this.middlewareEmitWarnings)
                        {
                            this.emitWarning(err);
                        }
                    }
                    callback(err, request.data);
                }
            }
        );
    }

    private async _processPublishAction(
        options: EventObject,
        request: RequestObject,
        callback: (err: Error, eventData?: any, data?: any) => any
    ): Promise<void>
    {
        let callbackInvoked = false;

        if (this.allowClientPublish)
        {
            const eventData = options.data || {};
            request.channel = eventData.channel;
            request.data    = eventData.data;

            await applyEachSeries(this._middleware[this.MIDDLEWARE_PUBLISH_IN], request,
                (err) =>
                {
                    if (callbackInvoked)
                    {
                        this.emitWarning(
                            new InvalidActionError(
                                `Callback for ${this.MIDDLEWARE_PUBLISH_IN} middleware was already invoked`
                            )
                        );
                    }
                    else
                    {
                        callbackInvoked = true;
                        if (request.data !== undefined)
                        {
                            eventData.data = request.data;
                        }
                        if (err)
                        {
                            if (err === true || err.silent)
                            {
                                err = new SilentMiddlewareBlockedError(
                                    `Action was silently blocked by ${this.MIDDLEWARE_PUBLISH_IN} middleware`,
                                    this.MIDDLEWARE_PUBLISH_IN
                                );
                            }
                            else if (this.middlewareEmitWarnings)
                            {
                                this.emitWarning(err);
                            }
                            callback(err, eventData, request.ackData);
                        }
                        else
                        {
                            if (typeof request.channel !== 'string')
                            {
                                err = new BrokerError(
                                    `Socket ${request.socket.id} tried to publish to an invalid ${request.channel} channel`
                                );
                                this.emitWarning(err);
                                callback(err, eventData, request.ackData);
                                return;
                            }
                            (async () =>
                            {
                                let error;
                                try
                                {
                                    await this.exchange.publish(request.channel, request.data);
                                }
                                catch (err)
                                {
                                    error = err;
                                    this.emitWarning(error);
                                }
                                callback(error, eventData, request.ackData);
                            })();
                        }
                    }
                }
            );
        }
        else
        {
            const noPublishError = new InvalidActionError('Client publish feature is disabled');
            this.emitWarning(noPublishError);
            callback(noPublishError);
        }
    }

    private async _processInvokeAction(
        options: EventObject,
        request: RequestObject,
        callback: (err: Error, data?: any) => any
    ): Promise<void>
    {
        let callbackInvoked = false;

        request.event = options.event;
        request.data  = options.data;

        await applyEachSeries(this._middleware[this.MIDDLEWARE_INVOKE], request,
            (err) =>
            {
                if (callbackInvoked)
                {
                    this.emitWarning(
                        new InvalidActionError(
                            `Callback for ${this.MIDDLEWARE_INVOKE} middleware was already invoked`
                        )
                    );
                }
                else
                {
                    callbackInvoked = true;
                    if (err)
                    {
                        if (err === true || err.silent)
                        {
                            err = new SilentMiddlewareBlockedError(
                                `Action was silently blocked by ${this.MIDDLEWARE_INVOKE} middleware`,
                                this.MIDDLEWARE_INVOKE
                            );
                        }
                        else if (this.middlewareEmitWarnings)
                        {
                            this.emitWarning(err);
                        }
                    }
                    callback(err, request.data);
                }
            }
        );
    }

    private _passThroughMiddleware(options: EventObject, callback: (err: Error, data?: any) => any): void
    {
        const request: RequestObject = {
            socket: options.socket
        };

        if (options.authTokenExpiredError != null)
        {
            request.authTokenExpiredError = options.authTokenExpiredError;
        }

        const event = options.event;

        if (options.cid == null)
        {
            // If transmit.
            if (this._isReservedRemoteEvent(event))
            {
                if (event === '#publish')
                {
                    this._processPublishAction(options, request, callback);
                }
                else if (event === '#removeAuthToken')
                {
                    callback(null, options.data);
                }
                else
                {
                    const error = new InvalidActionError(`The reserved transmitted event ${event} is not supported`);
                    callback(error);
                }
            }
            else
            {
                this._processTransmitAction(options, request, callback);
            }
        }
        else
        {
            // If invoke/RPC.
            if (this._isReservedRemoteEvent(event))
            {
                if (event === '#subscribe')
                {
                    this._processSubscribeAction(options, request, callback);
                }
                else if (event === '#publish')
                {
                    this._processPublishAction(options, request, callback);
                }
                else if (
                    event === '#handshake' ||
                    event === '#authenticate' ||
                    event === '#unsubscribe'
                )
                {
                    callback(null, options.data);
                }
                else
                {
                    const error = new InvalidActionError(`The reserved invoked event ${event} is not supported`);
                    callback(error);
                }
            }
            else
            {
                this._processInvokeAction(options, request, callback);
            }
        }
    }

    private _isReservedRemoteEvent(event?: string): boolean
    {
        return typeof event === 'string' && event.indexOf('#') === 0;
    }

    private _handleServerError(error: string|Error): void
    {
        if (typeof error === 'string')
        {
            error = new ServerProtocolError(error);
        }
        this.emitError(error);
    }

    private _handleHandshakeTimeout(scSocket: TGSocket): void
    {
        scSocket.disconnect(4005);
    }

    private async _handleSocketErrors(socket: any): Promise<void>
    {
        // A socket error will show up as a warning on the server.
        for await (const event of socket.listener('error'))
        {
            this.emitWarning(event.error);
        }
    }

    private async _subscribeSocket(socket: TGSocket, channelOptions: TGServerChannelOptions): Promise<void>
    {
        if (!channelOptions)
        {
            throw new InvalidActionError(`Socket ${socket.id} provided a malformated channel payload`);
        }

        if (this.socketChannelLimit && socket.channelSubscriptionsCount >= this.socketChannelLimit)
        {
            throw new InvalidActionError(
                `Socket ${socket.id} tried to exceed the channel subscription limit of ${this.socketChannelLimit}`
            );
        }

        const channelName = channelOptions.channel;

        if (typeof channelName !== 'string')
        {
            throw new InvalidActionError(`Socket ${socket.id} provided an invalid channel name`);
        }

        if (socket.channelSubscriptionsCount == null)
        {
            socket.channelSubscriptionsCount = 0;
        }
        if (socket.channelSubscriptions[channelName] == null)
        {
            socket.channelSubscriptions[channelName] = true;
            socket.channelSubscriptionsCount++;
        }

        try
        {
            await this.brokerEngine.subscribeSocket(socket, channelOptions);
        }
        catch (err)
        {
            delete socket.channelSubscriptions[channelName];
            socket.channelSubscriptionsCount--;
            throw err;
        }
        socket.emit('subscribe', {
            channel         : channelName,
            subscribeOptions: channelOptions
        });
        this.emit('subscription', {
            socket,
            channel         : channelName,
            subscribeOptions: channelOptions
        });
    }

    private _unsubscribeSocketFromAllChannels(socket: TGSocket): void
    {
        Object.keys(socket.channelSubscriptions).forEach((channelName) =>
        {
            this._unsubscribeSocket(socket, channelName);
        });
    };

    private _unsubscribeSocket(socket: TGSocket, channel: string): void
    {
        if (typeof channel !== 'string')
        {
            throw new InvalidActionError(
                `Socket ${socket.id} tried to unsubscribe from an invalid channel name`
            );
        }
        if (!socket.channelSubscriptions[channel])
        {
            throw new InvalidActionError(
                `Socket ${socket.id} tried to unsubscribe from a channel which it is not subscribed to`
            );
        }

        delete socket.channelSubscriptions[channel];
        if (socket.channelSubscriptionsCount != null)
        {
            socket.channelSubscriptionsCount--;
        }

        this.brokerEngine.unsubscribeSocket(socket, channel);

        socket.emit('unsubscribe', { channel });
        this.emit('unsubscription', { socket, channel });
    };

    private _processTokenError(err: AuthTokenError): {
        authError: AuthTokenError,
        isBadToken: boolean
    }
    {
        let authError  = null;
        let isBadToken = true;

        if (err)
        {
            if (err.name === 'TokenExpiredError')
            {
                authError = new AuthTokenExpiredError(err.message, err.expiredAt);
            }
            else if (err.name === 'JsonWebTokenError')
            {
                authError = new AuthTokenInvalidError(err.message);
            }
            else if (err.name === 'NotBeforeError')
            {
                authError  = new AuthTokenNotBeforeError(err.message, err.date);
                // In this case, the token is good; it's just not active yet.
                isBadToken = false;
            }
            else
            {
                authError = new AuthTokenError(err.message);
            }
        }

        return {
            authError : authError,
            isBadToken: isBadToken
        };
    };

    private _emitBadAuthTokenError(scSocket: TGSocket, error: Error, signedAuthToken: string): void
    {
        scSocket.emit('badAuthToken', {
            authError      : error,
            signedAuthToken: signedAuthToken
        });
        this.emit('badSocketAuthToken', {
            socket         : scSocket,
            authError      : error,
            signedAuthToken: signedAuthToken
        });
    };

    private _processAuthToken(
        scSocket: TGSocket,
        signedAuthToken: string,
        callback: (middlewareError: Error, isBadToken?: boolean, oldAuthState?: AuthState) => any
    )
    {
        const verificationOptions = Object.assign({ socket: scSocket }, this.defaultVerificationOptions);

        const handleVerifyTokenResult = (result) =>
        {
            const err   = result.error;
            const token = result.token;

            const oldAuthState = scSocket.authState;
            if (token)
            {
                scSocket.signedAuthToken = signedAuthToken;
                scSocket.authToken       = token;
                scSocket.authState       = scSocket.AUTHENTICATED;
            }
            else
            {
                scSocket.signedAuthToken = null;
                scSocket.authToken       = null;
                scSocket.authState       = scSocket.UNAUTHENTICATED;
            }

            // If the socket is authenticated, pass it through the MIDDLEWARE_AUTHENTICATE middleware.
            // If the token is bad, we will tell the client to remove it.
            // If there is an error but the token is good, then we will send back a 'quiet' error instead
            // (as part of the status object only).
            if (scSocket.authToken)
            {
                this._passThroughAuthenticateMiddleware({
                    socket         : scSocket,
                    signedAuthToken: scSocket.signedAuthToken,
                    authToken      : scSocket.authToken
                }, (middlewareError, isBadToken) =>
                {
                    if (middlewareError)
                    {
                        scSocket.authToken = null;
                        scSocket.authState = scSocket.UNAUTHENTICATED;
                        if (isBadToken)
                        {
                            this._emitBadAuthTokenError(scSocket, middlewareError, signedAuthToken);
                        }
                    }
                    // If an error is passed back from the authenticate middleware, it will be treated as a
                    // server warning and not a socket error.
                    callback(middlewareError, isBadToken || false, oldAuthState);
                });
            }
            else
            {
                const errorData = this._processTokenError(err);

                // If the error is related to the JWT being badly formatted, then we will
                // treat the error as a socket error.
                if (err && signedAuthToken != null)
                {
                    scSocket.emitError(errorData.authError);
                    if (errorData.isBadToken)
                    {
                        this._emitBadAuthTokenError(scSocket, errorData.authError, signedAuthToken);
                    }
                }
                callback(errorData.authError, errorData.isBadToken, oldAuthState);
            }
        };

        let verifyTokenResult;
        let verifyTokenError;

        try
        {
            verifyTokenResult = this.auth.verifyToken(signedAuthToken, this.verificationKey, verificationOptions);
        }
        catch (err)
        {
            verifyTokenError = err;
        }

        if (verifyTokenResult instanceof Promise)
        {
            (async () =>
            {
                const result: {token?: any, error?: Error} = {};
                try
                {
                    result.token = await verifyTokenResult;
                }
                catch (err)
                {
                    result.error = err;
                }
                handleVerifyTokenResult(result);
            })();
        }
        else
        {
            const result = {
                token: verifyTokenResult,
                error: verifyTokenError
            };
            handleVerifyTokenResult(result);
        }
    }

    private async _passThroughAuthenticateMiddleware(
        options: EventObject,
        callback: (error?: Error, isBadToken?: boolean) => any
    ): Promise<void>
    {
        let callbackInvoked = false;

        const request = {
            socket   : options.socket,
            authToken: options.authToken
        };

        await applyEachSeries(this._middleware[this.MIDDLEWARE_AUTHENTICATE], request,
            (err, results) =>
            {
                if (callbackInvoked)
                {
                    this.emitWarning(
                        new InvalidActionError(
                            `Callback for ${this.MIDDLEWARE_AUTHENTICATE} middleware was already invoked`
                        )
                    );
                }
                else
                {
                    callbackInvoked = true;
                    let isBadToken  = false;
                    if (results.length)
                    {
                        isBadToken = results[results.length - 1] || false;
                    }
                    if (err)
                    {
                        if (err === true || err.silent)
                        {
                            err = new SilentMiddlewareBlockedError(
                                `Action was silently blocked by ${this.MIDDLEWARE_AUTHENTICATE} middleware`,
                                this.MIDDLEWARE_AUTHENTICATE
                            );
                        }
                        else if (this.middlewareEmitWarnings)
                        {
                            this.emitWarning(err);
                        }
                    }
                    callback(err, isBadToken);
                }
            }
        );
    }

    private async _passThroughHandshakeAGMiddleware(
        options: EventObject,
        callback: (error?: Error, code?: number) => void
    ): Promise<void>
    {
        let callbackInvoked = false;
        const request       = {
            socket: options.socket
        };

        await applyEachSeries(this._middleware[this.MIDDLEWARE_HANDSHAKE_AG], request,
            (err, results) =>
            {
                if (callbackInvoked)
                {
                    this.emitWarning(
                        new InvalidActionError(
                            `Callback for ${this.MIDDLEWARE_HANDSHAKE_AG} middleware was already invoked`
                        )
                    );
                }
                else
                {
                    callbackInvoked = true;
                    let statusCode;
                    if (results.length)
                    {
                        statusCode = results[results.length - 1] || 4008;
                    }
                    else
                    {
                        statusCode = 4008;
                    }
                    if (err)
                    {
                        if (err.statusCode != null)
                        {
                            statusCode = err.statusCode;
                        }
                        if (err === true || err.silent)
                        {
                            err = new SilentMiddlewareBlockedError(
                                `Action was silently blocked by ${this.MIDDLEWARE_HANDSHAKE_AG} middleware`,
                                this.MIDDLEWARE_HANDSHAKE_AG
                            );
                        }
                        else if (this.middlewareEmitWarnings)
                        {
                            this.emitWarning(err);
                        }
                    }
                    callback(err, statusCode);
                }
            }
        );
    }
}
