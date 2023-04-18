import { AsyncStreamEmitter } from '../async-stream-emitter';
import { AuthEngine } from '../auth';
import { ConsumableStream } from '../consumable-stream';
import { randomBytes } from '../crypto';
import {
    InvalidActionError,
    InvalidArgumentsError,
    InvalidOptionsError,
    ServerProtocolError,
    SilentMiddlewareBlockedError,
} from '../errors/errors';
import { formatter } from '../formatter';
import { JwtAlgorithm, JwtVerifyOptions, Secret } from '../jwt';
import { TGSimpleBroker } from '../simple-broker/simple-broker';
import { SimpleExchange } from '../simple-broker/simple-exchange';
import { generateId } from '../utils/generate-id';
import { isNode } from '../utils/is-node';
import { WritableConsumableStream } from '../writable-consumable-stream';
import { TGAction } from './action';
import { TGServerSocket } from './server-socket';
import {
    AuthEngineType,
    AuthenticationData,
    AuthStateChangeData,
    BadSocketAuthTokenData,
    ClosureData,
    ConnectionAbortData,
    ConnectionData,
    DeauthenticationData,
    DisconnectionData,
    handshakeMiddlewareFunction,
    inboundMiddlewareFunction,
    inboundRawMiddlewareFunction,
    MIDDLEWARE_HANDSHAKE,
    MIDDLEWARE_INBOUND,
    MIDDLEWARE_INBOUND_RAW,
    MIDDLEWARE_OUTBOUND,
    Middlewares,
    outboundMiddlewareFunction,
    SubscriptionData,
    TGServerSocketGatewayOptions,
    UnsubscriptionData,
} from './types';
import { CodecEngine } from '../types';

export class TGServerSocketGateway extends AsyncStreamEmitter<any>
{
    static MIDDLEWARE_HANDSHAKE: Middlewares = MIDDLEWARE_HANDSHAKE;
    static MIDDLEWARE_INBOUND_RAW: Middlewares = MIDDLEWARE_INBOUND_RAW;
    static MIDDLEWARE_INBOUND: Middlewares = MIDDLEWARE_INBOUND;
    static MIDDLEWARE_OUTBOUND: Middlewares = MIDDLEWARE_OUTBOUND;
    static SYMBOL_MIDDLEWARE_HANDSHAKE_STREAM = Symbol('handshakeStream');

    options: TGServerSocketGatewayOptions;
    origins: string;
    ackTimeout: number;
    handshakeTimeout: number;
    pingInterval: number;
    pingTimeout: number;
    pingTimeoutDisabled: boolean;
    allowClientPublish: boolean;
    perMessageDeflate?: boolean | any;
    httpServer: any;
    socketChannelLimit?: number;
    protocolVersion: 1 | 2;
    strictHandshake: boolean;
    brokerEngine: TGSimpleBroker;
    middlewareEmitFailures: boolean;
    isReady: boolean;
    signatureKey?: Secret;
    verificationKey?: Secret;
    defaultVerificationOptions: JwtVerifyOptions | JwtAlgorithm;
    defaultSignatureOptions: {
        expiresIn: number;
        algorithm?: string;
    };
    exchange: SimpleExchange;

    clients: {
        [id: string]: TGServerSocket;
    };
    clientsCount: number;

    pendingClients: {
        [id: string]: TGServerSocket;
    };
    pendingClientsCount: number;

    auth: AuthEngineType;
    wsServer: any;
    codec: CodecEngine;
    private readonly _middleware: { [key: string]: any };
    private readonly _allowAllOrigins: boolean;
    private readonly _path: string;

    /**
     * Constructor
     */
    constructor(options?: TGServerSocketGatewayOptions)
    {
        super();

        const opts: TGServerSocketGatewayOptions = {
            brokerEngine: new TGSimpleBroker(),
            wsEngine: 'ws',
            wsEngineServerOptions: {},
            maxPayload: null,
            allowClientPublish: true,
            ackTimeout: 10000,
            handshakeTimeout: 10000,
            strictHandshake: true,
            pingTimeout: 20000,
            pingTimeoutDisabled: false,
            pingInterval: 8000,
            origins: '*:*',
            path: '/topgunsocket/',
            protocolVersion: 2,
            authDefaultExpiry: 86400,
            batchOnHandshake: false,
            batchOnHandshakeDuration: 400,
            batchInterval: 50,
            middlewareEmitFailures: true,
            socketStreamCleanupMode: 'kill',
            cloneData: false,
            isNode: isNode(),
        };

        this.options = Object.assign(opts, options);

        this._middleware = {};

        this.origins = this.options.origins;
        this._allowAllOrigins = this.origins.indexOf('*:*') !== -1;

        this.ackTimeout = this.options.ackTimeout;
        this.handshakeTimeout = this.options.handshakeTimeout;
        this.pingInterval = this.options.pingInterval;
        this.pingTimeout = this.options.pingTimeout;
        this.pingTimeoutDisabled = this.options.pingTimeoutDisabled;
        this.allowClientPublish = this.options.allowClientPublish;
        this.perMessageDeflate = this.options.perMessageDeflate;
        this.httpServer = this.options.httpServer;
        this.socketChannelLimit = this.options.socketChannelLimit;
        this.protocolVersion = this.options.protocolVersion;
        this.strictHandshake = this.options.strictHandshake;

        this.brokerEngine = this.options.brokerEngine;
        this.middlewareEmitFailures = this.options.middlewareEmitFailures;

        this._path = opts.path;

        (async () =>
        {
            for await (const { error } of this.brokerEngine.listener('error'))
            {
                this.emitWarning(error);
            }
        })();

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

        if (!this.options.wsEngine)
        {
            throw new InvalidOptionsError(
                'The wsEngine option must be a path or module name which points ' +
                    'to a valid WebSocket engine module with a compatible interface'
            );
        }
        const WSServer: any = this.options.wsEngine;

        if (
            this.options.authPrivateKey != null ||
            this.options.authPublicKey != null
        )
        {
            if (this.options.authPrivateKey == null)
            {
                throw new InvalidOptionsError(
                    'The authPrivateKey option must be specified if authPublicKey is specified'
                );
            }
            else if (this.options.authPublicKey == null)
            {
                throw new InvalidOptionsError(
                    'The authPublicKey option must be specified if authPrivateKey is specified'
                );
            }
            this.signatureKey = this.options.authPrivateKey;
            this.verificationKey = this.options.authPublicKey;
        }
        else
        {
            if (this.options.authKey == null)
            {
                this.options.authKey = randomBytes(32).toString();
            }
            this.signatureKey = this.options.authKey;
            this.verificationKey = this.options.authKey;
        }

        this.defaultVerificationOptions = {};
        if (this.options.authVerifyAlgorithm != null)
        {
            this.defaultVerificationOptions.algorithm =
                this.options.authVerifyAlgorithm;
        }
        else if (this.options.authAlgorithm != null)
        {
            this.defaultVerificationOptions.algorithm =
                this.options.authAlgorithm;
        }

        this.defaultSignatureOptions = {
            expiresIn: this.options.authDefaultExpiry,
        };
        if (this.options.authAlgorithm != null)
        {
            this.defaultSignatureOptions.algorithm = this.options.authAlgorithm;
        }

        if (this.options.authEngine)
        {
            this.auth = this.options.authEngine;
        }
        else
        {
            // Default authentication engine
            this.auth = new AuthEngine();
        }

        if (this.options.codecEngine)
        {
            this.codec = this.options.codecEngine;
        }
        else
        {
            // Default codec engine
            this.codec = formatter;
        }
        this.brokerEngine.setCodecEngine(this.codec);
        this.exchange = this.brokerEngine.exchange();

        this.clients = {};
        this.clientsCount = 0;

        this.pendingClients = {};
        this.pendingClientsCount = 0;

        const wsServerOptions = this.options.wsEngineServerOptions || {};
        wsServerOptions.server = this.httpServer;
        wsServerOptions.verifyClient = this.verifyHandshake.bind(this);

        if (wsServerOptions.path == null && this._path != null)
        {
            wsServerOptions.path = this._path;
        }
        if (
            wsServerOptions.perMessageDeflate == null &&
            this.perMessageDeflate != null
        )
        {
            wsServerOptions.perMessageDeflate = this.perMessageDeflate;
        }
        if (
            wsServerOptions.handleProtocols == null &&
            this.options.handleProtocols != null
        )
        {
            wsServerOptions.handleProtocols = this.options.handleProtocols;
        }
        if (wsServerOptions.maxPayload == null && opts.maxPayload != null)
        {
            wsServerOptions.maxPayload = opts.maxPayload;
        }
        if (wsServerOptions.clientTracking == null)
        {
            wsServerOptions.clientTracking = false;
        }

        if (this.options.isNode)
        {
            this.wsServer = new WSServer(wsServerOptions);

            this.wsServer.on('error', this._handleServerError.bind(this));
            this.wsServer.on(
                'connection',
                this._handleSocketConnection.bind(this)
            );
        }
        else
        {
            this.wsServer = WSServer;
            this.wsServer.addEventListener(
                'close',
                this._closeOrErrorHandler.bind(this)
            );
            this.wsServer.addEventListener(
                'error',
                this._closeOrErrorHandler.bind(this)
            );
        }
    }

    // -----------------------------------------------------------------------------------------------------
    // @ Public methods
    // -----------------------------------------------------------------------------------------------------

    setAuthEngine(authEngine: AuthEngineType): void
    {
        this.auth = authEngine;
    }

    setCodecEngine(codecEngine: CodecEngine): void
    {
        this.codec = codecEngine;
        this.brokerEngine.setCodecEngine(codecEngine);
    }

    emit(eventName: 'error', data: { error: Error }): void;
    emit(eventName: 'warning', data: { warning: Error }): void;
    emit(eventName: 'handshake', data: { socket: TGServerSocket }): void;
    emit(
        eventName: 'authenticationStateChange',
        data: AuthStateChangeData
    ): void;
    emit(eventName: 'authentication', data: AuthenticationData): void;
    emit(eventName: 'deauthentication', data: DeauthenticationData): void;
    emit(eventName: 'badSocketAuthToken', data: BadSocketAuthTokenData): void;
    emit(eventName: 'connection', data: ConnectionData): void;
    emit(eventName: 'subscription', data: SubscriptionData): void;
    emit(eventName: 'unsubscription', data: UnsubscriptionData): void;
    emit(eventName: 'connectionAbort', data: ConnectionAbortData): void;
    emit(eventName: 'disconnection', data: DisconnectionData): void;
    emit(eventName: 'closure', data: ClosureData): void;
    emit(eventName: 'ready', data: any): void;
    emit(eventName: string, data: any): void
    {
        return super.emit(eventName, data);
    }

    listener(eventName: 'error'): ConsumableStream<{ error: Error }>;
    listener(eventName: 'warning'): ConsumableStream<{ warning: Error }>;
    listener(
        eventName: 'handshake'
    ): ConsumableStream<{ socket: TGServerSocket }>;
    listener(
        eventName: 'authenticationStateChange'
    ): ConsumableStream<AuthStateChangeData>;
    listener(eventName: 'authentication'): ConsumableStream<AuthenticationData>;
    listener(
        eventName: 'deauthentication'
    ): ConsumableStream<DeauthenticationData>;
    listener(
        eventName: 'badSocketAuthToken'
    ): ConsumableStream<BadSocketAuthTokenData>;
    listener(eventName: 'connection'): ConsumableStream<ConnectionData>;
    listener(eventName: 'subscription'): ConsumableStream<SubscriptionData>;
    listener(eventName: 'unsubscription'): ConsumableStream<UnsubscriptionData>;
    listener(
        eventName: 'connectionAbort'
    ): ConsumableStream<ConnectionAbortData>;
    listener(eventName: 'disconnection'): ConsumableStream<DisconnectionData>;
    listener(eventName: 'closure'): ConsumableStream<ClosureData>;
    listener(eventName: 'ready'): ConsumableStream<any>;
    listener(eventName: string): ConsumableStream<any>
    {
        return super.listener(eventName);
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
        });
    }

    getPath(): string
    {
        return this._path;
    }

    generateId(): string
    {
        return generateId();
    }

    setMiddleware(
        type: typeof TGServerSocketGateway.MIDDLEWARE_HANDSHAKE,
        middleware: handshakeMiddlewareFunction
    ): void;
    setMiddleware(
        type: typeof TGServerSocketGateway.MIDDLEWARE_INBOUND_RAW,
        middleware: inboundRawMiddlewareFunction
    ): void;
    setMiddleware(
        type: typeof TGServerSocketGateway.MIDDLEWARE_INBOUND,
        middleware: inboundMiddlewareFunction
    ): void;
    setMiddleware(
        type: typeof TGServerSocketGateway.MIDDLEWARE_OUTBOUND,
        middleware: outboundMiddlewareFunction
    ): void;
    setMiddleware(type: Middlewares, middleware: any)
    {
        if (
            type !== TGServerSocketGateway.MIDDLEWARE_HANDSHAKE &&
            type !== TGServerSocketGateway.MIDDLEWARE_INBOUND_RAW &&
            type !== TGServerSocketGateway.MIDDLEWARE_INBOUND &&
            type !== TGServerSocketGateway.MIDDLEWARE_OUTBOUND
        )
        {
            throw new InvalidArgumentsError(
                `Middleware type "${type}" is not supported`
            );
        }
        if (this._middleware[type])
        {
            throw new InvalidActionError(
                `Middleware type "${type}" has already been set`
            );
        }
        this._middleware[type] = middleware;
    }

    removeMiddleware(type: Middlewares): void
    {
        delete this._middleware[type];
    }

    hasMiddleware(type: Middlewares): boolean
    {
        return !!this._middleware[type];
    }

    async verifyHandshake(info: any, callback: any): Promise<any>
    {
        const req = info.req;
        let origin = info.origin;
        if (origin === 'null' || origin == null)
        {
            origin = '*';
        }
        let ok: boolean | number = false;

        if (this._allowAllOrigins)
        {
            ok = true;
        }
        else
        {
            try
            {
                const parser = new URL(origin);
                const port =
                    parser.port || (parser.protocol === 'https:' ? 443 : 80);
                ok =
                    ~this.origins.indexOf(parser.hostname + ':' + port) ||
                    ~this.origins.indexOf(parser.hostname + ':*') ||
                    ~this.origins.indexOf('*:' + port);
            }
            catch (e)
            {}
        }

        const middlewareHandshakeStream = new WritableConsumableStream();
        middlewareHandshakeStream.type =
            TGServerSocketGateway.MIDDLEWARE_HANDSHAKE;

        req[TGServerSocketGateway.SYMBOL_MIDDLEWARE_HANDSHAKE_STREAM] =
            middlewareHandshakeStream;

        const handshakeMiddleware =
            this._middleware[TGServerSocketGateway.MIDDLEWARE_HANDSHAKE];
        if (handshakeMiddleware)
        {
            handshakeMiddleware(middlewareHandshakeStream);
        }

        const action = new TGAction();
        action.request = req;
        action.type = TGAction.HANDSHAKE_WS;

        try
        {
            await this.processMiddlewareAction(
                middlewareHandshakeStream,
                action
            );
        }
        catch (error)
        {
            middlewareHandshakeStream.close();
            callback(
                false,
                401,
                typeof error === 'string' ? error : (error as Error).message
            );
            return;
        }

        if (ok)
        {
            callback(true);
            return;
        }

        const error = new ServerProtocolError(
            `Failed to authorize socket handshake - Invalid origin: ${origin}`
        );
        this.emitWarning(error);

        middlewareHandshakeStream.close();
        callback(false, 403, error.message);
    }

    async processMiddlewareAction(
        middlewareStream: any,
        action: TGAction,
        socket?: any
    ): Promise<{ data: any; options: any }>
    {
        if (!this.hasMiddleware(middlewareStream.type))
        {
            return { data: action.data, options: null };
        }
        middlewareStream.write(action);

        let newData;
        let options = null;
        try
        {
            const result = await action.promise;
            if (result)
            {
                newData = result.data;
                options = result.options;
            }
        }
        catch (error)
        {
            let clientError;
            if (!error)
            {
                error = new SilentMiddlewareBlockedError(
                    `The ${action.type} AGAction was blocked by ${middlewareStream.type} middleware`,
                    middlewareStream.type
                );
                clientError = error;
            }
            else if ((error as any).silent)
            {
                clientError = new SilentMiddlewareBlockedError(
                    `The ${action.type} AGAction was blocked by ${middlewareStream.type} middleware`,
                    middlewareStream.type
                );
            }
            else
            {
                clientError = error;
            }
            if (this.middlewareEmitFailures)
            {
                if (socket)
                {
                    socket.emitError(error);
                }
                else
                {
                    this.emitWarning(error as Error);
                }
            }
            throw clientError;
        }

        if (newData === undefined)
        {
            newData = action.data;
        }

        return { data: newData, options };
    }

    // -----------------------------------------------------------------------------------------------------
    // @ Private methods
    // -----------------------------------------------------------------------------------------------------

    private _closeOrErrorHandler(error?: Error): void
    {
        if (error)
        {
            this.emitError(error);
        }
        this.close();
    }

    private _handleServerError(error: Error): void
    {
        if (typeof error === 'string')
        {
            error = new ServerProtocolError(error);
        }
        this.emitError(error);
    }

    private _handleSocketConnection(wsSocket: any, upgradeReq: any): void
    {
        if (!wsSocket.upgradeReq)
        {
            // Normalize ws modules to match.
            wsSocket.upgradeReq = upgradeReq;
        }

        const socketId = this.generateId();
        const agSocket = new TGServerSocket(
            socketId,
            this,
            wsSocket,
            this.protocolVersion
        );
        agSocket.exchange = this.exchange;

        const inboundRawMiddleware =
            this._middleware[TGServerSocketGateway.MIDDLEWARE_INBOUND_RAW];
        if (inboundRawMiddleware)
        {
            inboundRawMiddleware(agSocket.middlewareInboundRawStream);
        }

        const inboundMiddleware =
            this._middleware[TGServerSocketGateway.MIDDLEWARE_INBOUND];
        if (inboundMiddleware)
        {
            inboundMiddleware(agSocket.middlewareInboundStream);
        }

        const outboundMiddleware =
            this._middleware[TGServerSocketGateway.MIDDLEWARE_OUTBOUND];
        if (outboundMiddleware)
        {
            outboundMiddleware(agSocket.middlewareOutboundStream);
        }

        // Emit event to signal that a socket handshake has been initiated.
        this.emit('handshake', { socket: agSocket });
    }
}
