import { AsyncStreamEmitter } from '../async-stream-emitter';
import { ConsumableStream } from '../consumable-stream';
import {
    AuthError,
    AuthTokenError,
    AuthTokenExpiredError,
    AuthTokenInvalidError,
    AuthTokenNotBeforeError,
    BadConnectionError,
    BrokerError,
    dehydrateError,
    hydrateError,
    InvalidActionError,
    InvalidArgumentsError,
    SocketProtocolError,
    socketProtocolErrorStatuses,
    socketProtocolIgnoreStatuses,
    TimeoutError,
} from '../errors/errors';
import {
    SocketProtocolErrorStatuses,
    SocketProtocolIgnoreStatuses,
} from '../errors/types';
import { TGRequest } from '../request/request';
import { SimpleExchange } from '../simple-broker/simple-exchange';
import { StreamDemux } from '../stream-demux';
import { DemuxedConsumableStream } from '../stream-demux/demuxed-consumable-stream';
import { AuthToken, EventObject, UnsubscribeData } from '../types';
import { cloneDeep } from '../utils/clone-deep';
import { WritableConsumableStream } from '../writable-consumable-stream';
import { ConsumerStats } from '../writable-consumable-stream/consumer-stats';
import { TGAction } from './action';
import { TGServerSocketGateway } from './server';
import {
    AuthenticateData,
    AuthState,
    AuthStateChangeData,
    AuthTokenOptions,
    BadAuthTokenData,
    CloseData,
    ConnectAbortData,
    ConnectData,
    DeauthenticateData,
    DisconnectData,
    IncomingMessage,
    IncomingMessageKey,
    SocketState,
    StateChangeData,
    SubscribeData,
    SubscriptionOptions,
} from './types';

const HANDSHAKE_REJECTION_STATUS_CODE = 4008;

export class TGServerSocket extends AsyncStreamEmitter<any>
{
    static CONNECTING: SocketState = 'connecting';
    static OPEN: SocketState = 'open';
    static CLOSED: SocketState = 'closed';
    static AUTHENTICATED: AuthState = 'authenticated';
    static UNAUTHENTICATED: AuthState = 'unauthenticated';

    static ignoreStatuses: SocketProtocolIgnoreStatuses =
        socketProtocolIgnoreStatuses;
    static errorStatuses: SocketProtocolErrorStatuses =
        socketProtocolErrorStatuses;

    id: string;
    server: TGServerSocketGateway;
    socket: any;
    protocolVersion: number;

    request: IncomingMessage;

    inboundReceivedMessageCount: number;
    inboundProcessedMessageCount: number;
    outboundPreparedMessageCount: number;
    outboundSentMessageCount: number;

    cloneData: boolean;

    inboundMessageStream: WritableConsumableStream<any>;
    outboundPacketStream: WritableConsumableStream<any>;
    middlewareHandshakeStream: WritableConsumableStream<any>;
    middlewareInboundRawStream: WritableConsumableStream<any>;
    middlewareInboundStream: WritableConsumableStream<any>;
    middlewareOutboundStream: WritableConsumableStream<any>;

    remoteAddress: string;
    remoteFamily: string;
    remotePort: number;
    forwardedForAddress?: string;

    isBufferingBatch: boolean;
    isBatching: boolean;
    batchOnHandshake: boolean;
    batchOnHandshakeDuration: number;
    batchInterval: number;

    channelSubscriptions: {
        [channelName: string]: boolean;
    };
    channelSubscriptionsCount: number;

    exchange: SimpleExchange;

    state: SocketState;
    authState: AuthState;
    authToken?: AuthToken;
    signedAuthToken?: string;
    private _receiverDemux: StreamDemux<unknown>;
    private _procedureDemux: StreamDemux<unknown>;
    private _batchBuffer: any[];
    private _batchingIntervalId: any = null;
    private _cid: number;
    private readonly _callbackMap: { [key: string]: any };
    private readonly _sendPing: () => void;
    private readonly _pingIntervalTicker: any;
    private readonly _handshakeTimeoutRef: any;
    private _pingTimeoutTicker: any;

    /**
     * Constructor
     */
    constructor(
        id: string,
        server: TGServerSocketGateway,
        socket: WebSocket,
        protocolVersion: number
    )
    {
        super();
        this.id = id;
        this.server = server;
        this.socket = socket;
        this.state = TGServerSocket.CONNECTING;
        this.authState = TGServerSocket.UNAUTHENTICATED;
        this.protocolVersion = protocolVersion;

        this._receiverDemux = new StreamDemux();
        this._procedureDemux = new StreamDemux();

        this.request = this.socket['upgradeReq'];

        this.inboundReceivedMessageCount = 0;
        this.inboundProcessedMessageCount = 0;

        this.outboundPreparedMessageCount = 0;
        this.outboundSentMessageCount = 0;

        this.cloneData = this.server.options.cloneData;

        this.inboundMessageStream = new WritableConsumableStream();
        this.outboundPacketStream = new WritableConsumableStream();

        this.middlewareHandshakeStream =
            this.request[
                TGServerSocketGateway.SYMBOL_MIDDLEWARE_HANDSHAKE_STREAM as unknown as keyof IncomingMessage
            ];

        this.middlewareInboundRawStream = new WritableConsumableStream();
        this.middlewareInboundRawStream.type =
            TGServerSocketGateway.MIDDLEWARE_INBOUND_RAW;

        this.middlewareInboundStream = new WritableConsumableStream();
        this.middlewareInboundStream.type =
            TGServerSocketGateway.MIDDLEWARE_INBOUND;

        this.middlewareOutboundStream = new WritableConsumableStream();
        this.middlewareOutboundStream.type =
            TGServerSocketGateway.MIDDLEWARE_OUTBOUND;

        if (this.request['connection' as IncomingMessageKey])
        {
            this.remoteAddress =
                this.request['connection' as IncomingMessageKey].remoteAddress;
            this.remoteFamily =
                this.request['connection' as IncomingMessageKey].remoteFamily;
            this.remotePort =
                this.request['connection' as IncomingMessageKey].remotePort;
        }
        else
        {
            this.remoteAddress = this.request.remoteAddress;
            this.remoteFamily = this.request.remoteFamily;
            this.remotePort = this.request.remotePort;
        }
        if (this.request.forwardedForAddress)
        {
            this.forwardedForAddress = this.request.forwardedForAddress;
        }

        this.isBufferingBatch = false;
        this.isBatching = false;
        this.batchOnHandshake = this.server.options.batchOnHandshake;
        this.batchOnHandshakeDuration =
            this.server.options.batchOnHandshakeDuration;
        this.batchInterval = this.server.options.batchInterval;
        this._batchBuffer = [];

        this._batchingIntervalId = null;
        this._cid = 1;
        this._callbackMap = {};

        this.channelSubscriptions = {};
        this.channelSubscriptionsCount = 0;

        this._on('error', async (err) =>
        {
            this.emitError(err);
        });

        this._on('close', async (code, reasonBuffer) =>
        {
            const reason = reasonBuffer && reasonBuffer.toString();
            this._destroy(code, reason);
        });

        let pongMessage: string;
        if (this.protocolVersion === 1)
        {
            pongMessage = '#2';
            this._sendPing = () =>
            {
                if (this.state !== TGServerSocket.CLOSED)
                {
                    this.send('#1');
                }
            };
        }
        else
        {
            pongMessage = '';
            this._sendPing = () =>
            {
                if (this.state !== TGServerSocket.CLOSED)
                {
                    this.send('');
                }
            };
        }

        if (!this.server.pingTimeoutDisabled)
        {
            this._pingIntervalTicker = setInterval(() =>
            {
                this._sendPing();
            }, this.server.pingInterval);
        }
        this._resetPongTimeout();

        this._handshakeTimeoutRef = setTimeout(() =>
        {
            this._handleHandshakeTimeout();
        }, this.server.handshakeTimeout);

        this.server.pendingClients[this.id] = this;
        this.server.pendingClientsCount++;

        this._handleInboundMessageStream(pongMessage);
        this._handleOutboundPacketStream();

        // Receive incoming raw messages
        this._on('message', async (messageBuffer, isBinary) =>
        {
            let message = isBinary ? messageBuffer : messageBuffer.toString();
            this.inboundReceivedMessageCount++;

            const isPong = message === pongMessage;

            if (isPong)
            {
                this._resetPongTimeout();
            }

            if (
                this.server.hasMiddleware(
                    TGServerSocketGateway.MIDDLEWARE_INBOUND_RAW
                )
            )
            {
                const action = new TGAction();
                action.socket = this;
                action.type = TGAction.MESSAGE;
                action.data = message;

                try
                {
                    const { data } = await this.server.processMiddlewareAction(
                        this.middlewareInboundRawStream,
                        action,
                        this
                    );
                    message = data;
                }
                catch (error)
                {
                    this.inboundProcessedMessageCount++;
                    return;
                }
            }

            this.inboundMessageStream.write(message);
            this.emit('message', { message });
        });
    }

    // -----------------------------------------------------------------------------------------------------
    // @ Public methods
    // -----------------------------------------------------------------------------------------------------

    getBackpressure(): number
    {
        return Math.max(
            this.getInboundBackpressure(),
            this.getOutboundBackpressure(),
            this.getAllListenersBackpressure(),
            this.getAllReceiversBackpressure(),
            this.getAllProceduresBackpressure()
        );
    }

    getInboundBackpressure(): number
    {
        return (
            this.inboundReceivedMessageCount - this.inboundProcessedMessageCount
        );
    }

    getOutboundBackpressure(): number
    {
        return (
            this.outboundPreparedMessageCount - this.outboundSentMessageCount
        );
    }

    // ---- Receiver logic ----

    receiver(receiverName: string): DemuxedConsumableStream<any>
    {
        return this._receiverDemux.stream(receiverName);
    }

    closeReceiver(receiverName: string): void
    {
        this._receiverDemux.close(receiverName);
    }

    closeAllReceivers(): void
    {
        this._receiverDemux.closeAll();
    }

    killReceiver(receiverName: string): void
    {
        this._receiverDemux.kill(receiverName);
    }

    killAllReceivers(): void
    {
        this._receiverDemux.killAll();
    }

    killReceiverConsumer(consumerId: number): void
    {
        this._receiverDemux.killConsumer(consumerId);
    }

    getReceiverConsumerStats(consumerId: number): ConsumerStats
    {
        return this._receiverDemux.getConsumerStats(consumerId);
    }

    getReceiverConsumerStatsList(receiverName: string): ConsumerStats[]
    {
        return this._receiverDemux.getConsumerStatsList(receiverName);
    }

    getAllReceiversConsumerStatsList(): ConsumerStats[]
    {
        return this._receiverDemux.getConsumerStatsListAll();
    }

    getReceiverBackpressure(receiverName: string): number
    {
        return this._receiverDemux.getBackpressure(receiverName);
    }

    getAllReceiversBackpressure(): number
    {
        return this._receiverDemux.getBackpressureAll();
    }

    getReceiverConsumerBackpressure(consumerId: number): number
    {
        return this._receiverDemux.getConsumerBackpressure(consumerId);
    }

    hasReceiverConsumer(receiverName: string, consumerId: number): boolean
    {
        return this._receiverDemux.hasConsumer(receiverName, consumerId);
    }

    hasAnyReceiverConsumer(consumerId: number): boolean
    {
        return this._receiverDemux.hasConsumerAll(consumerId);
    }

    // ---- Procedure logic ----

    procedure(procedureName: string): DemuxedConsumableStream<any>
    {
        return this._procedureDemux.stream(procedureName);
    }

    closeProcedure(procedureName: string): void
    {
        this._procedureDemux.close(procedureName);
    }

    closeAllProcedures(): void
    {
        this._procedureDemux.closeAll();
    }

    killProcedure(procedureName: string): void
    {
        this._procedureDemux.kill(procedureName);
    }

    killAllProcedures(): void
    {
        this._procedureDemux.killAll();
    }

    killProcedureConsumer(consumerId: number): void
    {
        this._procedureDemux.killConsumer(consumerId);
    }

    getProcedureConsumerStats(consumerId: number): ConsumerStats
    {
        return this._procedureDemux.getConsumerStats(consumerId);
    }

    getProcedureConsumerStatsList(procedureName: string): ConsumerStats[]
    {
        return this._procedureDemux.getConsumerStatsList(procedureName);
    }

    getAllProceduresConsumerStatsList(): ConsumerStats[]
    {
        return this._procedureDemux.getConsumerStatsListAll();
    }

    getProcedureBackpressure(procedureName: string): number
    {
        return this._procedureDemux.getBackpressure(procedureName);
    }

    getAllProceduresBackpressure(): number
    {
        return this._procedureDemux.getBackpressureAll();
    }

    getProcedureConsumerBackpressure(consumerId: number): number
    {
        return this._procedureDemux.getConsumerBackpressure(consumerId);
    }

    hasProcedureConsumer(procedureName: string, consumerId: number): boolean
    {
        return this._procedureDemux.hasConsumer(procedureName, consumerId);
    }

    hasAnyProcedureConsumer(consumerId: number): boolean
    {
        return this._procedureDemux.hasConsumerAll(consumerId);
    }

    emit(
        eventName: 'message' | 'raw',
        data: { message: { data: any; type: string; target: WebSocket } }
    ): void;
    emit(eventName: 'error', data: { error: Error }): void;
    emit(eventName: 'authStateChange', data: StateChangeData): void;
    emit(eventName: 'authenticate', data: AuthenticateData): void;
    emit(eventName: 'authTokenSigned', data: { signedAuthToken: string }): void;
    emit(eventName: 'deauthenticate', data: DeauthenticateData): void;
    emit(eventName: 'badAuthToken', data: BadAuthTokenData): void;
    emit(eventName: 'connect', data: ConnectData): void;
    emit(eventName: 'subscribe', data: SubscribeData): void;
    emit(eventName: 'unsubscribe', data: UnsubscribeData): void;
    emit(eventName: 'connectAbort', data: ConnectAbortData): void;
    emit(eventName: 'disconnect', data: DisconnectData): void;
    emit(eventName: 'close', data: CloseData): void;
    emit(eventName: 'message' | 'raw'): ConsumableStream<{
        message: { data: any; type: string; target: WebSocket };
    }>;
    emit(eventName: 'error'): ConsumableStream<{ error: Error }>;
    emit(eventName: 'authStateChange'): ConsumableStream<StateChangeData>;
    emit(eventName: 'authenticate'): ConsumableStream<AuthenticateData>;
    emit(
        eventName: 'authTokenSigned'
    ): ConsumableStream<{ signedAuthToken: string }>;
    emit(eventName: 'deauthenticate'): ConsumableStream<DeauthenticateData>;
    emit(eventName: 'badAuthToken'): ConsumableStream<BadAuthTokenData>;
    emit(eventName: 'connect'): ConsumableStream<ConnectData>;
    emit(eventName: 'subscribe'): ConsumableStream<SubscribeData>;
    emit(eventName: 'unsubscribe'): ConsumableStream<UnsubscribeData>;
    emit(eventName: 'connectAbort'): ConsumableStream<ConnectAbortData>;
    emit(eventName: 'disconnect'): ConsumableStream<DisconnectData>;
    emit(eventName: 'close'): ConsumableStream<CloseData>;
    emit(eventName: 'end'): ConsumableStream<CloseData>;
    emit(eventName: string, data?: any): any
    {
        return super.emit(eventName, data);
    }

    getState(): SocketState
    {
        return this.state;
    }

    getBytesReceived(): number
    {
        return this.socket['bytesReceived'];
    }

    emitError(error: Error): void
    {
        this.emit('error', { error });
        this.server.emitWarning(error);
    }

    closeAllMiddlewares(): void
    {
        this.middlewareHandshakeStream.close();
        this.middlewareInboundRawStream.close();
        this.middlewareInboundStream.close();
        this.middlewareOutboundStream.close();
    }

    closeInput(): void
    {
        this.inboundMessageStream.close();
    }

    closeOutput(): void
    {
        this.outboundPacketStream.close();
    }

    closeIO(): void
    {
        this.closeInput();
        this.closeOutput();
    }

    closeAllStreams(): void
    {
        this.closeAllMiddlewares();
        this.closeIO();

        this.closeAllReceivers();
        this.closeAllProcedures();
        this.closeAllListeners();
    }

    killAllMiddlewares(): void
    {
        this.middlewareHandshakeStream.kill();
        this.middlewareInboundRawStream.kill();
        this.middlewareInboundStream.kill();
        this.middlewareOutboundStream.kill();
    }

    killInput(): void
    {
        this.inboundMessageStream.kill();
    }

    killOutput(): void
    {
        this.outboundPacketStream.kill();
    }

    killIO(): void
    {
        this.killInput();
        this.killOutput();
    }

    killAllStreams(): void
    {
        this.killAllMiddlewares();
        this.killIO();

        this.killAllReceivers();
        this.killAllProcedures();
        this.killAllListeners();
    }

    async disconnect(code?: number, reason?: string): Promise<void>
    {
        code = code || 1000;

        if (typeof code !== 'number')
        {
            const err = new InvalidArgumentsError(
                'If specified, the code argument must be a number'
            );
            this.emitError(err);
        }

        if (this.state !== TGServerSocket.CLOSED)
        {
            await this._destroy(code, reason);
            this.socket.close(code, reason);
        }
    }

    terminate(): void
    {
        if (this.server.options.isNode)
        {
            this.socket['terminate']();
        }
        else
        {
            this.disconnect();
        }
    }

    send(
        data: any,
        options?: {
            mask?: boolean;
            binary?: boolean;
            compress?: boolean;
            fin?: boolean;
        }
    ): void
    {
        if (this.server.options.isNode)
        {
            this.socket.send(data, options, (error: Error) =>
            {
                if (error)
                {
                    this.emitError(error);
                    this._destroy(1006, error.toString());
                }
            });
        }
        else
        {
            this.socket.send(data);
        }
    }

    decode(message: any): any
    {
        return this.server.codec.decode(message);
    }

    encode(object: any): any
    {
        return this.server.codec.encode(object);
    }

    startBatch(): void
    {
        this.isBufferingBatch = true;
        this._batchBuffer = [];
    }

    flushBatch(): void
    {
        this.isBufferingBatch = false;
        if (!this._batchBuffer.length)
        {
            return;
        }
        const serializedBatch = this.serializeObject(this._batchBuffer);
        this._batchBuffer = [];
        this.send(serializedBatch);
    }

    cancelBatch(): void
    {
        this.isBufferingBatch = false;
        this._batchBuffer = [];
    }

    startBatching(): void
    {
        this.isBatching = true;
        this._startBatching();
    }

    stopBatching(): void
    {
        this.isBatching = false;
        this._stopBatching();
    }

    cancelBatching(): void
    {
        this.isBatching = false;
        this._cancelBatching();
    }

    serializeObject(object: any): any
    {
        let str;
        try
        {
            str = this.encode(object);
        }
        catch (error)
        {
            this.emitError(error as Error);
            return null;
        }
        return str;
    }

    sendObject(object: any): void
    {
        if (this.isBufferingBatch)
        {
            this._batchBuffer.push(object);
            return;
        }
        const str = this.serializeObject(object);
        if (str != null)
        {
            this.send(str);
        }
    }

    async transmit(event: string, data: any, options?: any): Promise<void>
    {
        if (this.state !== TGServerSocket.OPEN)
        {
            const error = new BadConnectionError(
                `Socket transmit "${event}" was aborted due to a bad connection`,
                'connectAbort'
            );
            this.emitError(error);
            return;
        }
        this._transmit(event, data, options);
    }

    async invoke(event: string, data?: any, options?: any): Promise<any>
    {
        if (this.state !== TGServerSocket.OPEN)
        {
            const error = new BadConnectionError(
                `Socket invoke "${event}" was aborted due to a bad connection`,
                'connectAbort'
            );
            this.emitError(error);
            throw error;
        }
        if (this.cloneData)
        {
            data = cloneDeep(data);
        }
        this.outboundPreparedMessageCount++;
        return new Promise((resolve, reject) =>
        {
            this.outboundPacketStream.write({
                event,
                data,
                options,
                resolve,
                reject,
            });
        });
    }

    triggerAuthenticationEvents(oldAuthState: AuthState): void
    {
        if (oldAuthState !== TGServerSocket.AUTHENTICATED)
        {
            const stateChangeData: StateChangeData = {
                oldState: oldAuthState,
                newState: this.authState,
                authToken: this.authToken,
            };
            this.emit('authStateChange', stateChangeData);
            this.server.emit('authenticationStateChange', {
                socket: this,
                ...stateChangeData,
            } as AuthStateChangeData);
        }
        this.emit('authenticate', { authToken: this.authToken });
        this.server.emit('authentication', {
            socket: this,
            authToken: this.authToken,
        });
    }

    async setAuthToken(
        data: AuthToken,
        options?: AuthTokenOptions
    ): Promise<void>
    {
        if (this.state === TGServerSocket.CONNECTING)
        {
            const err = new InvalidActionError(
                'Cannot call setAuthToken before completing the handshake'
            );
            this.emitError(err);
            throw err;
        }

        const authToken = cloneDeep(data);
        const oldAuthState = this.authState;
        this.authState = TGServerSocket.AUTHENTICATED;

        if (options == null)
        {
            options = {};
        }
        else
        {
            options = { ...options };
            if (options.algorithm != null)
            {
                delete options.algorithm;
                const err = new InvalidArgumentsError(
                    'Cannot change auth token algorithm at runtime - It must be specified as a config option on launch'
                );
                this.emitError(err);
            }
        }

        // options.mutatePayload      = true;
        const rejectOnFailedDelivery = options.rejectOnFailedDelivery;
        delete options.rejectOnFailedDelivery;
        const defaultSignatureOptions = this.server.defaultSignatureOptions;

        // We cannot have the exp claim on the token and the expiresIn option
        // set at the same time or else auth.signToken will throw an error.
        let expiresIn;
        if (data.exp == null)
        {
            expiresIn = defaultSignatureOptions.expiresIn;
        }
        else
        {
            expiresIn = data.exp;
        }
        if (authToken)
        {
            if (authToken.exp == null)
            {
                data.exp = expiresIn;
            }
            else
            {
                delete data.exp;
            }
        }
        else
        {
            data.exp = expiresIn;
        }

        // Always use the default algorithm since it cannot be changed at runtime.
        if (defaultSignatureOptions.algorithm != null)
        {
            options.algorithm = defaultSignatureOptions.algorithm;
        }

        this.authToken = authToken;

        let signedAuthToken;

        try
        {
            signedAuthToken = await this.server.auth.signToken(
                authToken,
                this.server.signatureKey,
                options
            );
        }
        catch (error)
        {
            this.emitError(error as Error);
            this._destroy(4002, error.toString());
            this.socket.close(4002);
            throw error;
        }

        if (this.authToken === authToken)
        {
            this.signedAuthToken = signedAuthToken;
            this.emit('authTokenSigned', { signedAuthToken });
        }

        this.triggerAuthenticationEvents(oldAuthState);

        const tokenData = {
            token: signedAuthToken,
        };

        if (rejectOnFailedDelivery)
        {
            try
            {
                await this.invoke('#setAuthToken', tokenData);
            }
            catch (err)
            {
                const error = new AuthError(
                    `Failed to deliver auth token to client - ${err}`
                );
                this.emitError(error);
                throw error;
            }
            return;
        }
        this.transmit('#setAuthToken', tokenData);
    }

    getAuthToken(): AuthToken
    {
        return this.authToken;
    }

    deauthenticateSelf(): void
    {
        const oldAuthState = this.authState;
        const oldAuthToken = this.authToken;
        this.signedAuthToken = null;
        this.authToken = null;
        this.authState = TGServerSocket.UNAUTHENTICATED;
        if (oldAuthState !== TGServerSocket.UNAUTHENTICATED)
        {
            const stateChangeData: StateChangeData = {
                oldState: oldAuthState,
                newState: this.authState,
            };
            this.emit('authStateChange', stateChangeData);
            this.server.emit('authenticationStateChange', {
                socket: this,
                ...stateChangeData,
            });
        }
        this.emit('deauthenticate', { oldAuthToken });
        this.server.emit('deauthentication', {
            socket: this,
            oldAuthToken,
        });
    }

    async deauthenticate(options?: {
        rejectOnFailedDelivery: boolean;
    }): Promise<void>
    {
        this.deauthenticateSelf();
        if (options && options.rejectOnFailedDelivery)
        {
            try
            {
                await this.invoke('#removeAuthToken');
            }
            catch (error)
            {
                this.emitError(error as Error);
                if (options && options.rejectOnFailedDelivery)
                {
                    throw error;
                }
            }
            return;
        }
        this._transmit('#removeAuthToken');
    }

    kickOut(channel?: string, message?: string): any
    {
        let channels: string | string[] = channel;
        if (!channels)
        {
            channels = Object.keys(this.channelSubscriptions);
        }
        if (!Array.isArray(channels))
        {
            channels = [channel];
        }
        return Promise.all(
            channels.map((channelName) =>
            {
                this.transmit('#kickOut', { channel: channelName, message });
                return this._unsubscribe(channelName);
            })
        );
    }

    subscriptions(): string[]
    {
        return Object.keys(this.channelSubscriptions);
    }

    isSubscribed(channel: string): boolean
    {
        return !!this.channelSubscriptions[channel];
    }

    isAuthTokenExpired(token: AuthToken): boolean
    {
        if (token && token.exp != null)
        {
            const currentTime = Date.now();
            const expiryMilliseconds = token.exp * 1000;
            return currentTime > expiryMilliseconds;
        }
        return false;
    }

    // -----------------------------------------------------------------------------------------------------
    // @ Private methods
    // -----------------------------------------------------------------------------------------------------

    private async _processAuthentication({
        signedAuthToken,
        authTokenError,
        authToken,
    }: any): Promise<any>
    {
        if (authTokenError)
        {
            this.signedAuthToken = null;
            this.authToken = null;
            this.authState = TGServerSocket.UNAUTHENTICATED;

            // If the error is related to the JWT being badly formatted, then we will
            // treat the error as a socket error.
            if (signedAuthToken != null)
            {
                this.emitError(authTokenError);
                if (authTokenError.isBadToken)
                {
                    this._emitBadAuthTokenError(
                        authTokenError,
                        signedAuthToken
                    );
                }
            }
            throw authTokenError;
        }

        this.signedAuthToken = signedAuthToken;
        this.authToken = authToken;
        this.authState = TGServerSocket.AUTHENTICATED;

        const action = new TGAction();
        action.socket = this;
        action.type = TGAction.AUTHENTICATE;
        action.signedAuthToken = this.signedAuthToken;
        action.authToken = this.authToken;

        try
        {
            await this.server.processMiddlewareAction(
                this.middlewareInboundStream,
                action,
                this
            );
        }
        catch (error)
        {
            this.authToken = null;
            this.authState = TGServerSocket.UNAUTHENTICATED;

            if ((error as AuthTokenExpiredError).isBadToken)
            {
                this._emitBadAuthTokenError(error as Error, signedAuthToken);
            }
            throw error;
        }
    }

    private async _validateAuthToken(signedAuthToken: string): Promise<any>
    {
        const verificationOptions = Object.assign(
            {},
            this.server.defaultVerificationOptions,
            {
                socket: this,
                throwError: true,
            }
        );

        let authToken;
        try
        {
            authToken = await this.server.auth.verifyToken(
                signedAuthToken,
                this.server.verificationKey,
                verificationOptions
            );
        }
        catch (error)
        {
            const authTokenError = this._processTokenError(error as Error);
            return {
                signedAuthToken,
                authTokenError,
                authToken: null,
                authState: TGServerSocket.UNAUTHENTICATED,
            };
        }

        return {
            signedAuthToken,
            authTokenError: null,
            authToken,
            authState: TGServerSocket.AUTHENTICATED,
        };
    }

    private _emitBadAuthTokenError(
        error: Error,
        signedAuthToken: string
    ): void
    {
        this.emit('badAuthToken', {
            authError: error,
            signedAuthToken,
        });
        this.server.emit('badSocketAuthToken', {
            socket: this,
            authError: error,
            signedAuthToken,
        });
    }

    private _processTokenError(err: Error): any
    {
        if (err)
        {
            if (err.message === 'TokenExpiredError')
            {
                const authError = new AuthTokenExpiredError(
                    err.message,
                    (err as AuthTokenError).expiredAt
                );
                authError.isBadToken = true;
                return authError;
            }
            if (err.message === 'ParseError')
            {
                const authError = new AuthTokenInvalidError(err.message);
                authError.isBadToken = true;
                return authError;
            }
            if (err.message === 'NotYetValid')
            {
                const authError = new AuthTokenNotBeforeError(
                    err.message,
                    (err as AuthTokenError).date
                );
                // In this case, the token is good; it's just not active yet.
                authError.isBadToken = false;
                return authError;
            }
            const authError = new AuthTokenError(err.message);
            authError.isBadToken = true;
            return authError;
        }
        return null;
    }

    private _processAuthTokenExpiry(): any
    {
        const token = this.getAuthToken();
        if (this.isAuthTokenExpired(token))
        {
            this.deauthenticate();

            return new AuthTokenExpiredError(
                'The socket auth token has expired',
                token.exp
            );
        }
        return null;
    }

    private async _invoke(
        event: string,
        data: any,
        options: any
    ): Promise<any>
    {
        options = options || {};

        return new Promise((resolve, reject) =>
        {
            const eventObject: any = {
                event,
                cid: this._nextCallId(),
            };
            if (data !== undefined)
            {
                eventObject.data = data;
            }

            const ackTimeout =
                options.ackTimeout == null
                    ? this.server.ackTimeout
                    : options.ackTimeout;

            const timeout = setTimeout(() =>
            {
                const error = new TimeoutError(
                    `Event response for "${event}" timed out`
                );
                delete this._callbackMap[eventObject.cid];
                reject(error);
            }, ackTimeout);

            this._callbackMap[eventObject.cid] = {
                event,
                callback: (err: Error, result: any) =>
                {
                    if (err)
                    {
                        reject(err);
                        return;
                    }
                    resolve(result);
                },
                timeout,
            };

            if (
                options.useCache &&
                options.stringifiedData != null &&
                !this.isBufferingBatch
            )
            {
                // Optimized
                this.send(options.stringifiedData);
            }
            else
            {
                this.sendObject(eventObject);
            }
        });
    }

    private async _processTransmit(
        event: string,
        data: any,
        options: any
    ): Promise<void>
    {
        let newData;
        let useCache = options ? options.useCache : false;
        const packet = { event, data };
        const isPublish = event === '#publish';
        if (isPublish)
        {
            const action = new TGAction();
            action.socket = this;
            action.type = TGAction.PUBLISH_OUT;

            if (data !== undefined)
            {
                action.channel = data.channel;
                action.data = data.data;
            }
            useCache = !this.server.hasMiddleware(
                this.middlewareOutboundStream.type
            );

            try
            {
                const { data, options } =
                    await this.server.processMiddlewareAction(
                        this.middlewareOutboundStream,
                        action,
                        this
                    );
                newData = data;
                useCache = options == null ? useCache : options.useCache;
            }
            catch (error)
            {
                return;
            }
        }
        else
        {
            newData = packet.data;
        }

        if (
            options &&
            useCache &&
            options.stringifiedData != null &&
            !this.isBufferingBatch
        )
        {
            // Optimized
            this.send(options.stringifiedData);
        }
        else
        {
            const eventObject: any = {
                event,
            };
            if (isPublish)
            {
                eventObject.data = data || {};
                eventObject.data.data = newData;
            }
            else
            {
                eventObject.data = newData;
            }

            this.sendObject(eventObject);
        }
    }

    private async _transmit(
        event: string,
        data?: any,
        options?: any
    ): Promise<void>
    {
        if (this.cloneData && data)
        {
            data = cloneDeep(data);
        }
        this.outboundPreparedMessageCount++;
        this.outboundPacketStream.write({
            event,
            data,
            options,
        });
    }

    private async _handleOutboundPacketStream(): Promise<void>
    {
        for await (const packet of this.outboundPacketStream)
        {
            if (packet.resolve)
            {
                // Invoke has no middleware, so there is no need to await here.
                (async () =>
                {
                    let result;
                    try
                    {
                        result = await this._invoke(
                            packet.event,
                            packet.data,
                            packet.options
                        );
                    }
                    catch (error)
                    {
                        packet.reject(error);
                        return;
                    }
                    packet.resolve(result);
                })();

                this.outboundSentMessageCount++;
                continue;
            }
            await this._processTransmit(
                packet.event,
                packet.data,
                packet.options
            );
            this.outboundSentMessageCount++;
        }
    }

    private _cancelBatching(): void
    {
        if (this._batchingIntervalId != null)
        {
            clearInterval(this._batchingIntervalId);
        }
        this._batchingIntervalId = null;
        this.cancelBatch();
    }

    private _stopBatching(): void
    {
        if (this._batchingIntervalId != null)
        {
            clearInterval(this._batchingIntervalId);
        }
        this._batchingIntervalId = null;
        this.flushBatch();
    }

    private _startBatching(): void
    {
        if (this._batchingIntervalId != null)
        {
            return;
        }
        this.startBatch();
        this._batchingIntervalId = setInterval(() =>
        {
            this.flushBatch();
            this.startBatch();
        }, this.batchInterval);
    }

    private async _destroy(code?: number, reason?: string): Promise<void>
    {
        clearInterval(this._pingIntervalTicker);
        clearTimeout(this._pingTimeoutTicker);

        this._cancelBatching();

        if (this.state === TGServerSocket.CLOSED)
        {
            this._abortAllPendingEventsDueToBadConnection('connectAbort');
        }
        else
        {
            if (
                !reason &&
                TGServerSocket.errorStatuses[
                    code as keyof SocketProtocolErrorStatuses
                ]
            )
            {
                reason =
                    TGServerSocket.errorStatuses[
                        code as keyof SocketProtocolErrorStatuses
                    ];
            }
            const prevState = this.state;
            this.state = TGServerSocket.CLOSED;
            if (prevState === TGServerSocket.CONNECTING)
            {
                this._abortAllPendingEventsDueToBadConnection('connectAbort');
                this.emit('connectAbort', { code, reason });
                this.server.emit('connectionAbort', {
                    socket: this,
                    code,
                    reason,
                });
            }
            else
            {
                this._abortAllPendingEventsDueToBadConnection('disconnect');
                this.emit('disconnect', { code, reason });
                this.server.emit('disconnection', {
                    socket: this,
                    code,
                    reason,
                });
            }

            this.emit('close', { code, reason });
            this.server.emit('closure', {
                socket: this,
                code,
                reason,
            });

            clearTimeout(this._handshakeTimeoutRef);
            const isClientFullyConnected = !!this.server.clients[this.id];

            if (isClientFullyConnected)
            {
                delete this.server.clients[this.id];
                this.server.clientsCount--;
            }

            const isClientPending = !!this.server.pendingClients[this.id];
            if (isClientPending)
            {
                delete this.server.pendingClients[this.id];
                this.server.pendingClientsCount--;
            }

            if (
                !TGServerSocket.ignoreStatuses[
                    code as keyof SocketProtocolIgnoreStatuses
                ]
            )
            {
                let closeMessage;
                if (reason)
                {
                    let reasonString: string;
                    if (typeof reason === 'object')
                    {
                        try
                        {
                            reasonString = JSON.stringify(reason);
                        }
                        catch (error)
                        {
                            reasonString = (reason as any).toString();
                        }
                    }
                    else
                    {
                        reasonString = reason;
                    }
                    closeMessage = `Socket connection closed with status code ${code} and reason: ${reasonString}`;
                }
                else
                {
                    closeMessage = `Socket connection closed with status code ${code}`;
                }
                const err = new SocketProtocolError(
                    TGServerSocket.errorStatuses[
                        code as keyof SocketProtocolErrorStatuses
                    ] || closeMessage,
                    code
                );
                this.emitError(err);
            }

            await this._unsubscribeFromAllChannels();

            const cleanupMode = this.server.options.socketStreamCleanupMode;
            if (cleanupMode === 'kill')
            {
                (async () =>
                {
                    await this.listener('end').once();
                    this.killAllStreams();
                })();
            }
            else if (cleanupMode === 'close')
            {
                (async () =>
                {
                    await this.listener('end').once();
                    this.closeAllStreams();
                })();
            }

            this.emit('end');
        }
    }

    private _abortAllPendingEventsDueToBadConnection(
        failureType: string
    ): void
    {
        Object.keys(this._callbackMap || {}).forEach((i) =>
        {
            const eventObject = this._callbackMap[i];
            delete this._callbackMap[i];

            clearTimeout(eventObject.timeout);
            delete eventObject.timeout;

            const errorMessage = `Event "${eventObject.event}" was aborted due to a bad connection`;
            const badConnectionError = new BadConnectionError(
                errorMessage,
                failureType
            );

            const callback = eventObject.callback;
            delete eventObject.callback;

            callback.call(eventObject, badConnectionError, eventObject);
        });
    }

    private async _handleInboundMessageStream(pongMessage: any): Promise<void>
    {
        for await (const message of this.inboundMessageStream)
        {
            this.inboundProcessedMessageCount++;
            const isPong = message === pongMessage;

            if (isPong)
            {
                if (
                    this.server.strictHandshake &&
                    this.state === TGServerSocket.CONNECTING
                )
                {
                    this._destroy(4009);
                    this.socket.close(4009);
                    continue;
                }
                const token = this.getAuthToken();
                if (this.isAuthTokenExpired(token))
                {
                    this.deauthenticate();
                }
                continue;
            }

            let packet;
            try
            {
                packet = this.decode(message);
            }
            catch (error)
            {
                if ((error as Error).name === 'Error')
                {
                    (error as Error).name = 'InvalidMessageError';
                }
                this.emitError(error as Error);
                if (
                    this.server.strictHandshake &&
                    this.state === TGServerSocket.CONNECTING
                )
                {
                    this._destroy(4009);
                    this.socket.close(4009);
                }
                continue;
            }

            if (Array.isArray(packet))
            {
                const len = packet.length;
                for (let i = 0; i < len; i++)
                {
                    await this._processInboundPacket(packet[i], message);
                }
            }
            else
            {
                await this._processInboundPacket(packet, message);
            }
        }
    }

    private _handleHandshakeTimeout(): void
    {
        this.disconnect(4005);
    }

    private async _processHandshakeRequest(request: TGRequest): Promise<void>
    {
        const data = request.data || {};
        const signedAuthToken = data.authToken || null;
        clearTimeout(this._handshakeTimeoutRef);

        const authInfo = await this._validateAuthToken(signedAuthToken);

        const action = new TGAction();
        action.request = this.request;
        action.socket = this;
        action.type = TGAction.HANDSHAKE_SC;
        action.data = authInfo;

        try
        {
            await this.server.processMiddlewareAction(
                this.middlewareHandshakeStream,
                action
            );
        }
        catch (error: any)
        {
            if (error.statusCode == null)
            {
                error.statusCode = HANDSHAKE_REJECTION_STATUS_CODE;
            }
            request.error(error as Error);
            this.disconnect(error.statusCode);
            return;
        }

        const clientSocketStatus: ConnectData = {
            id: this.id,
            pingTimeout: this.server.pingTimeout,
            isAuthenticated: false,
        };
        const serverSocketStatus: ConnectData = {
            id: this.id,
            pingTimeout: this.server.pingTimeout,
            isAuthenticated: false,
        };

        const oldAuthState = this.authState;
        try
        {
            await this._processAuthentication(authInfo);
            if (this.state === TGServerSocket.CLOSED)
            {
                return;
            }
        }
        catch (error)
        {
            if (signedAuthToken != null)
            {
                // Because the token is optional as part of the handshake, we don't count
                // it as an error if the token wasn't provided.
                clientSocketStatus.authError = dehydrateError(error);
                serverSocketStatus.authError = error as Error;

                if ((error as AuthTokenInvalidError).isBadToken)
                {
                    this.deauthenticate();
                }
            }
        }
        clientSocketStatus.isAuthenticated = !!this.authToken;
        serverSocketStatus.isAuthenticated = clientSocketStatus.isAuthenticated;

        if (this.server.pendingClients[this.id])
        {
            delete this.server.pendingClients[this.id];
            this.server.pendingClientsCount--;
        }
        this.server.clients[this.id] = this;
        this.server.clientsCount++;

        this.state = TGServerSocket.OPEN;

        if (clientSocketStatus.isAuthenticated)
        {
            // Needs to be executed after the connection event to allow
            // consumers to be setup from inside the connection loop.
            (async () =>
            {
                await this.listener('connect').once();
                this.triggerAuthenticationEvents(oldAuthState);
            })();
        }

        // Treat authentication failure as a 'soft' error
        request.end(clientSocketStatus);

        if (this.batchOnHandshake)
        {
            this._startBatchOnHandshake();
        }

        this.emit('connect', serverSocketStatus);
        this.server.emit('connection', { socket: this, ...serverSocketStatus });

        this.middlewareHandshakeStream.close();
    }

    private _startBatchOnHandshake(): void
    {
        this._startBatching();
        setTimeout(() =>
        {
            if (!this.isBatching)
            {
                this._stopBatching();
            }
        }, this.batchOnHandshakeDuration);
    }

    private async _processAuthenticateRequest(
        request: TGRequest
    ): Promise<void>
    {
        const signedAuthToken = request.data;
        const oldAuthState = this.authState;
        const authInfo = await this._validateAuthToken(signedAuthToken);
        try
        {
            await this._processAuthentication(authInfo);
        }
        catch (error)
        {
            if ((error as AuthTokenInvalidError).isBadToken)
            {
                this.deauthenticate();
                request.error(error as AuthTokenInvalidError);

                return;
            }

            request.end({
                isAuthenticated: !!this.authToken,
                authError:
                    signedAuthToken == null ? null : dehydrateError(error),
            });

            return;
        }
        this.triggerAuthenticationEvents(oldAuthState);
        request.end({
            isAuthenticated: !!this.authToken,
            authError: null,
        });
    }

    private async _subscribeSocket(
        channelName: string,
        subscriptionOptions: SubscriptionOptions
    ): Promise<void>
    {
        if (channelName === undefined || !subscriptionOptions)
        {
            throw new InvalidActionError(
                `Socket ${this.id} provided a malformated channel payload`
            );
        }

        if (
            this.server.socketChannelLimit &&
            this.channelSubscriptionsCount >= this.server.socketChannelLimit
        )
        {
            throw new InvalidActionError(
                `Socket ${this.id} tried to exceed the channel subscription limit of ${this.server.socketChannelLimit}`
            );
        }

        if (typeof channelName !== 'string')
        {
            throw new InvalidActionError(
                `Socket ${this.id} provided an invalid channel name`
            );
        }

        if (this.channelSubscriptionsCount == null)
        {
            this.channelSubscriptionsCount = 0;
        }
        if (this.channelSubscriptions[channelName] == null)
        {
            this.channelSubscriptions[channelName] = true;
            this.channelSubscriptionsCount++;
        }

        try
        {
            await this.server.brokerEngine.subscribeSocket(this, channelName);
        }
        catch (error)
        {
            delete this.channelSubscriptions[channelName];
            this.channelSubscriptionsCount--;
            throw error;
        }
        this.emit('subscribe', {
            channel: channelName,
            subscriptionOptions,
        });
        this.server.emit('subscription', {
            socket: this,
            channel: channelName,
            subscriptionOptions,
        });
    }

    private async _processSubscribeRequest(request: TGRequest): Promise<void>
    {
        const subscriptionOptions = Object.assign({}, request.data);
        const channelName = subscriptionOptions.channel;
        delete subscriptionOptions.channel;

        if (this.state === TGServerSocket.OPEN)
        {
            try
            {
                await this._subscribeSocket(channelName, subscriptionOptions);
            }
            catch (err)
            {
                const error = new BrokerError(
                    `Failed to subscribe socket to the ${channelName} channel - ${err}`
                );
                this.emitError(error);
                request.error(error);

                return;
            }

            request.end();

            return;
        }
        // This is an invalid state; it means the client tried to subscribe before
        // having completed the handshake.
        const error = new InvalidActionError(
            'Cannot subscribe socket to a channel before it has completed the handshake'
        );
        this.emitError(error);
        request.error(error);
    }

    private _unsubscribeFromAllChannels(): Promise<any>
    {
        const channels = Object.keys(this.channelSubscriptions);
        return Promise.all(
            channels.map(channel => this._unsubscribe(channel))
        );
    }

    private async _unsubscribe(channel: string): Promise<void>
    {
        if (typeof channel !== 'string')
        {
            throw new InvalidActionError(
                `Socket ${this.id} tried to unsubscribe from an invalid channel name`
            );
        }
        if (!this.channelSubscriptions[channel])
        {
            throw new InvalidActionError(
                `Socket ${this.id} tried to unsubscribe from a channel which it is not subscribed to`
            );
        }

        try
        {
            await this.server.brokerEngine.unsubscribeSocket(this, channel);
            delete this.channelSubscriptions[channel];
            if (this.channelSubscriptionsCount != null)
            {
                this.channelSubscriptionsCount--;
            }
            this.emit('unsubscribe', { channel });
            this.server.emit('unsubscription', { socket: this, channel });
        }
        catch (err)
        {
            const error = new BrokerError(
                `Failed to unsubscribe socket from the ${channel} channel - ${err}`
            );
            this.emitError(error);
        }
    }

    private async _processUnsubscribePacket(
        packet: EventObject
    ): Promise<void>
    {
        const channel = packet.data;
        try
        {
            await this._unsubscribe(channel);
        }
        catch (err)
        {
            const error = new BrokerError(
                `Failed to unsubscribe socket from the ${channel} channel - ${err}`
            );
            this.emitError(error);
        }
    }

    private async _processUnsubscribeRequest(
        request: TGRequest
    ): Promise<void>
    {
        const channel = request.data;
        try
        {
            await this._unsubscribe(channel);
        }
        catch (err)
        {
            const error = new BrokerError(
                `Failed to unsubscribe socket from the ${channel} channel - ${err}`
            );
            this.emitError(error);
            request.error(error);
            return;
        }
        request.end();
    }

    private async _processInboundPublishPacket(
        packet: EventObject
    ): Promise<void>
    {
        const data = packet.data || {};
        if (typeof data.channel !== 'string')
        {
            const error = new InvalidActionError(
                `Socket ${this.id} tried to invoke publish to an invalid "${data.channel}" channel`
            );
            this.emitError(error);
            return;
        }
        try
        {
            await this.server.exchange.invokePublish(data.channel, data.data);
        }
        catch (error)
        {
            this.emitError(error as Error);
        }
    }

    private async _processInboundPublishRequest(
        request: TGRequest
    ): Promise<void>
    {
        const data = request.data || {};
        if (typeof data.channel !== 'string')
        {
            const error = new InvalidActionError(
                `Socket ${this.id} tried to transmit publish to an invalid "${data.channel}" channel`
            );
            this.emitError(error);
            request.error(error);
            return;
        }
        try
        {
            await this.server.exchange.invokePublish(data.channel, data.data);
        }
        catch (error)
        {
            this.emitError(error as Error);
            request.error(error as Error);
            return;
        }
        request.end();
    }

    private async _processInboundPacket(
        packet: EventObject,
        message: any
    ): Promise<void>
    {
        if (packet && packet.event != null)
        {
            const eventName = packet.event;
            const isRPC = packet.cid != null;

            if (eventName === '#handshake')
            {
                const request = new TGRequest(
                    this,
                    packet.cid,
                    eventName,
                    packet.data
                );
                await this._processHandshakeRequest(request);
                this._procedureDemux.write(eventName, request);

                return;
            }
            if (
                this.server.strictHandshake &&
                this.state === TGServerSocket.CONNECTING
            )
            {
                this._destroy(4009);
                this.socket.close(4009);

                return;
            }
            if (eventName === '#authenticate')
            {
                // Let AGServer handle these events.
                const request = new TGRequest(
                    this,
                    packet.cid,
                    eventName,
                    packet.data
                );
                await this._processAuthenticateRequest(request);
                this._procedureDemux.write(eventName, request);

                return;
            }
            if (eventName === '#removeAuthToken')
            {
                this.deauthenticateSelf();
                this._receiverDemux.write(eventName, packet.data);

                return;
            }

            const action = new TGAction();
            action.socket = this;

            const tokenExpiredError = this._processAuthTokenExpiry();
            if (tokenExpiredError)
            {
                action.authTokenExpiredError = tokenExpiredError;
            }

            const isPublish = eventName === '#publish';
            const isSubscribe = eventName === '#subscribe';
            const isUnsubscribe = eventName === '#unsubscribe';

            if (isPublish)
            {
                if (!this.server.allowClientPublish)
                {
                    const error = new InvalidActionError(
                        'Client publish feature is disabled'
                    );
                    this.emitError(error);

                    if (isRPC)
                    {
                        const request = new TGRequest(
                            this,
                            packet.cid,
                            eventName,
                            packet.data
                        );
                        request.error(error);
                    }
                    return;
                }
                action.type = TGAction.PUBLISH_IN;
                if (packet.data)
                {
                    action.channel = packet.data.channel;
                    action.data = packet.data.data;
                }
            }
            else if (isSubscribe)
            {
                action.type = TGAction.SUBSCRIBE;
                if (packet.data)
                {
                    action.channel = packet.data.channel;
                    action.data = packet.data.data;
                }
            }
            else if (isUnsubscribe)
            {
                if (isRPC)
                {
                    const request = new TGRequest(
                        this,
                        packet.cid,
                        eventName,
                        packet.data
                    );
                    await this._processUnsubscribeRequest(request);
                    this._procedureDemux.write(eventName, request);
                    return;
                }
                await this._processUnsubscribePacket(packet);
                this._receiverDemux.write(eventName, packet.data);
                return;
            }
            else
            {
                if (isRPC)
                {
                    action.type = TGAction.INVOKE;
                    action.procedure = packet.event;
                    if (packet.data !== undefined)
                    {
                        action.data = packet.data;
                    }
                }
                else
                {
                    action.type = TGAction.TRANSMIT;
                    action.receiver = packet.event;
                    if (packet.data !== undefined)
                    {
                        action.data = packet.data;
                    }
                }
            }

            let newData;

            if (isRPC)
            {
                const request = new TGRequest(
                    this,
                    packet.cid,
                    eventName,
                    packet.data
                );
                try
                {
                    const { data } = await this.server.processMiddlewareAction(
                        this.middlewareInboundStream,
                        action,
                        this
                    );
                    newData = data;
                }
                catch (error)
                {
                    request.error(error as Error);

                    return;
                }

                if (isSubscribe)
                {
                    if (!request.data)
                    {
                        request.data = {};
                    }
                    request.data.data = newData;
                    await this._processSubscribeRequest(request);
                }
                else if (isPublish)
                {
                    if (!request.data)
                    {
                        request.data = {};
                    }
                    request.data.data = newData;
                    await this._processInboundPublishRequest(request);
                }
                else
                {
                    request.data = newData;
                }

                this._procedureDemux.write(eventName, request);

                return;
            }

            try
            {
                const { data } = await this.server.processMiddlewareAction(
                    this.middlewareInboundStream,
                    action,
                    this
                );
                newData = data;
            }
            catch (error)
            {
                return;
            }

            if (isPublish)
            {
                if (!packet.data)
                {
                    packet.data = {};
                }
                packet.data.data = newData;
                await this._processInboundPublishPacket(packet);
            }

            this._receiverDemux.write(eventName, newData);

            return;
        }

        if (
            this.server.strictHandshake &&
            this.state === TGServerSocket.CONNECTING
        )
        {
            this._destroy(4009);
            this.socket.close(4009);

            return;
        }

        if (packet && packet.rid != null)
        {
            // If incoming message is a response to a previously sent message
            const ret = this._callbackMap[packet.rid];
            if (ret)
            {
                clearTimeout(ret.timeout);
                delete this._callbackMap[packet.rid];
                const rehydratedError = hydrateError(packet.error);
                ret.callback(rehydratedError, packet.data);
            }
            return;
        }
        // The last remaining case is to treat the message as raw
        this.emit('raw', { message });
    }

    private _resetPongTimeout(): void
    {
        if (this.server.pingTimeoutDisabled)
        {
            return;
        }
        clearTimeout(this._pingTimeoutTicker);
        this._pingTimeoutTicker = setTimeout(() =>
        {
            this._destroy(4001);
            this.socket.close(4001);
        }, this.server.pingTimeout);
    }

    private _nextCallId(): number
    {
        return this._cid++;
    }

    /**
     * Listen websocket
     */
    private _on(
        event: 'message',
        cb: (messageBuffer: any, isBinary: boolean) => Promise<any>
    ): void;
    private _on(
        event: 'close',
        cb: (code: number, reasonBuffer: any) => Promise<any>
    ): void;
    private _on(event: 'error', cb: (error: any) => Promise<any>): void;
    private _on(
        event: 'message' | 'close' | 'error',
        cb: (arg1: any, arg2?: any) => Promise<any>
    ): void
    {
        if (this.server.options.isNode)
        {
            this.socket['on'](event, cb);
        }
        else
        {
            switch (event)
            {
            case 'message':
                this.socket['addEventListener'](event, (event: any) =>
                    cb(event.data)
                );
                break;
            case 'close':
            case 'error':
                this.socket['addEventListener'](event, (event: any) =>
                    cb(event)
                );
                break;
            }
        }
    }
}
