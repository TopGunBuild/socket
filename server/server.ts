import { AsyncStreamEmitter } from '../async-stream-emitter';
import {
    AGServerOptions,
    AuthEngineType,
    CodecEngine,
    MIDDLEWARE_HANDSHAKE,
    MIDDLEWARE_INBOUND_RAW,
    MIDDLEWARE_INBOUND,
    MIDDLEWARE_OUTBOUND,
    outboundMiddlewareFunction,
    inboundMiddlewareFunction,
    inboundRawMiddlewareFunction,
    handshakeMiddlewareFunction, Middlewares
} from './types';
import { AGServerSocket } from './server-socket';
import { SimpleExchange } from '../ag-simple-broker/simple-exchange';
import { Secret } from '../jwt';
import { AGSimpleBroker } from '../ag-simple-broker/simple-broker';
import {
    InvalidActionError,
    InvalidArgumentsError,
    InvalidOptionsError,
    ServerProtocolError
} from '../sc-errors/errors';
import { randomBytes } from '../crypto/crypto';
import { AuthEngine } from '../ag-auth';
import { formatter } from '../sc-formatter';
import { isNode } from '../utils/is-node';
import { generateId } from '../utils/generate-id';

export class AGServer extends AsyncStreamEmitter<any>
{
    static MIDDLEWARE_HANDSHAKE               = MIDDLEWARE_HANDSHAKE;
    static MIDDLEWARE_INBOUND_RAW             = MIDDLEWARE_INBOUND_RAW;
    static MIDDLEWARE_INBOUND                 = MIDDLEWARE_INBOUND;
    static MIDDLEWARE_OUTBOUND                = MIDDLEWARE_OUTBOUND;
    static SYMBOL_MIDDLEWARE_HANDSHAKE_STREAM = Symbol('handshakeStream');

    options: AGServerOptions;
    origins: string;
    ackTimeout: number;
    handshakeTimeout: number;
    pingInterval: number;
    pingTimeout: number;
    pingTimeoutDisabled: boolean;
    allowClientPublish: boolean;
    perMessageDeflate?: boolean|{};
    httpServer: any;
    socketChannelLimit?: number;
    protocolVersion: 1|2;
    strictHandshake: boolean;
    brokerEngine: AGSimpleBroker;
    middlewareEmitFailures: boolean;
    isReady: boolean;
    signatureKey?: Secret;
    verificationKey?: Secret;
    defaultVerificationOptions: {
        algorithms?: string[];
    };
    defaultSignatureOptions: {
        expiresIn: number;
        algorithm?: string;
    };
    exchange: SimpleExchange;

    clients: {
        [id: string]: AGServerSocket;
    };
    clientsCount: number;

    pendingClients: {
        [id: string]: AGServerSocket;
    };
    pendingClientsCount: number;

    wsServer: any;
    private _middleware: {[key: string]: any};
    private _allowAllOrigins: boolean;
    private _path: string;
    private auth: AuthEngineType;
    private codec: CodecEngine;
    private verifyHandshake: any;

    /**
     * Constructor
     */
    constructor(options?: AGServerOptions)
    {
        super();

        let opts = {
            brokerEngine            : new AGSimpleBroker(),
            wsEngine                : 'ws',
            wsEngineServerOptions   : {},
            maxPayload              : null,
            allowClientPublish      : true,
            ackTimeout              : 10000,
            handshakeTimeout        : 10000,
            strictHandshake         : true,
            pingTimeout             : 20000,
            pingTimeoutDisabled     : false,
            pingInterval            : 8000,
            origins                 : '*:*',
            path                    : '/socketcluster/',
            protocolVersion         : 2,
            authDefaultExpiry       : 86400,
            batchOnHandshake        : false,
            batchOnHandshakeDuration: 400,
            batchInterval           : 50,
            middlewareEmitFailures  : true,
            socketStreamCleanupMode : 'kill',
            cloneData               : false
        };

        this.options = Object.assign(opts, options);

        this._middleware = {};

        this.origins          = this.options.origins;
        this._allowAllOrigins = this.origins.indexOf('*:*') !== -1;

        this.ackTimeout          = this.options.ackTimeout;
        this.handshakeTimeout    = this.options.handshakeTimeout;
        this.pingInterval        = this.options.pingInterval;
        this.pingTimeout         = this.options.pingTimeout;
        this.pingTimeoutDisabled = this.options.pingTimeoutDisabled;
        this.allowClientPublish  = this.options.allowClientPublish;
        this.perMessageDeflate   = this.options.perMessageDeflate;
        this.httpServer          = this.options.httpServer;
        this.socketChannelLimit  = this.options.socketChannelLimit;
        this.protocolVersion     = this.options.protocolVersion;
        this.strictHandshake     = this.options.strictHandshake;

        this.brokerEngine           = this.options.brokerEngine;
        this.middlewareEmitFailures = this.options.middlewareEmitFailures;

        this._path = opts.path;

        (async () =>
        {
            for await (let { error } of this.brokerEngine.listener('error'))
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
        let WSServer = this.options.wsEngine;

        if (this.options.authPrivateKey != null || this.options.authPublicKey != null)
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
            this.signatureKey    = this.options.authPrivateKey;
            this.verificationKey = this.options.authPublicKey;
        }
        else
        {
            if (this.options.authKey == null)
            {
                this.options.authKey = randomBytes(32).toString();
            }
            this.signatureKey    = this.options.authKey;
            this.verificationKey = this.options.authKey;
        }

        this.defaultVerificationOptions = {};
        if (this.options.authVerifyAlgorithms != null)
        {
            this.defaultVerificationOptions.algorithms = this.options.authVerifyAlgorithms;
        }
        else if (this.options.authAlgorithm != null)
        {
            this.defaultVerificationOptions.algorithms = [this.options.authAlgorithm];
        }

        this.defaultSignatureOptions = {
            expiresIn: this.options.authDefaultExpiry
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

        this.clients      = {};
        this.clientsCount = 0;

        this.pendingClients      = {};
        this.pendingClientsCount = 0;

        let wsServerOptions          = this.options.wsEngineServerOptions || {};
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
        if (wsServerOptions.handleProtocols == null && this.options.handleProtocols != null)
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

        if (isNode())
        {
            this.wsServer = new WSServer(wsServerOptions);

            this.wsServer.on('error', this._handleServerError.bind(this));
            this.wsServer.on('connection', this._handleSocketConnection.bind(this));
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
            this.wsServer.close((err) =>
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
                for (let socket of Object.values(this.clients))
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

    setMiddleware(type: typeof MIDDLEWARE_HANDSHAKE, middleware: handshakeMiddlewareFunction): void;
    setMiddleware(type: typeof MIDDLEWARE_INBOUND_RAW, middleware: inboundRawMiddlewareFunction): void;
    setMiddleware(type: typeof MIDDLEWARE_INBOUND, middleware: inboundMiddlewareFunction): void;
    setMiddleware(type: typeof MIDDLEWARE_OUTBOUND, middleware: outboundMiddlewareFunction): void
    setMiddleware(type: Middlewares, middleware: any)
    {
        if (
            type !== AGServer.MIDDLEWARE_HANDSHAKE &&
            type !== AGServer.MIDDLEWARE_INBOUND_RAW &&
            type !== AGServer.MIDDLEWARE_INBOUND &&
            type !== AGServer.MIDDLEWARE_OUTBOUND
        )
        {
            throw new InvalidArgumentsError(
                `Middleware type "${type}" is not supported`
            );
        }
        if (this._middleware[type])
        {
            throw new InvalidActionError(`Middleware type "${type}" has already been set`);
        }
        this._middleware[type] = middleware;
    }

    // -----------------------------------------------------------------------------------------------------
    // @ Private methods
    // -----------------------------------------------------------------------------------------------------

    private _handleServerError(error: Error): void
    {
        if (typeof error === 'string')
        {
            error = new ServerProtocolError(error);
        }
        this.emitError(error);
    }

    private _handleSocketConnection(wsSocket, upgradeReq): void
    {
        if (!wsSocket.upgradeReq)
        {
            // Normalize ws modules to match.
            wsSocket.upgradeReq = upgradeReq;
        }

        let socketId = this.generateId();

        let agSocket      = new AGServerSocket(socketId, this, wsSocket, this.protocolVersion);
        agSocket.exchange = this.exchange;

        let inboundRawMiddleware = this._middleware[AGServer.MIDDLEWARE_INBOUND_RAW];
        if (inboundRawMiddleware)
        {
            inboundRawMiddleware(agSocket.middlewareInboundRawStream);
        }

        let inboundMiddleware = this._middleware[AGServer.MIDDLEWARE_INBOUND];
        if (inboundMiddleware)
        {
            inboundMiddleware(agSocket.middlewareInboundStream);
        }

        let outboundMiddleware = this._middleware[AGServer.MIDDLEWARE_OUTBOUND];
        if (outboundMiddleware)
        {
            outboundMiddleware(agSocket.middlewareOutboundStream);
        }

        // Emit event to signal that a socket handshake has been initiated.
        this.emit('handshake', { socket: agSocket });
    }
}