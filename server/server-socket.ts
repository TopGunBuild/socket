import { AsyncStreamEmitter } from '../async-stream-emitter';
import { AGServer } from './server';
import { SimpleExchange } from '../ag-simple-broker/simple-exchange';
import {
    AuthenticateData,
    AuthState,
    AuthToken, BadAuthTokenData, CloseData, ConnectAbortData, ConnectData,
    DeauthenticateData, DisconnectData,
    IncomingMessage,
    SocketState,
    StateChangeData, SubscribeData, SubscriptionOptions, UnsubscribeData
} from './types';
import { WritableConsumableStream } from '../writable-consumable-stream';
import { SocketProtocolErrorStatuses, SocketProtocolIgnoreStatuses } from '../sc-errors/types';
import { StreamDemux } from '../stream-demux';
import { AGAction } from './action';
import {
    BadConnectionError,
    BrokerError,
    dehydrateError, InvalidActionError, InvalidArgumentsError, SocketProtocolError,
    socketProtocolErrorStatuses,
    socketProtocolIgnoreStatuses
} from '../sc-errors/errors';
import { DemuxedConsumableStream } from '../stream-demux/demuxed-consumable-stream';
import { ConsumerStats } from '../writable-consumable-stream/consumer-stats';
import { ConsumableStream } from '../consumable-stream';
import { AGRequest } from '../ag-request';
import { EventObject } from '../types/transport';
import { isFunction } from '../utils/is-function';
import { isNode } from '../utils/is-node';

const HANDSHAKE_REJECTION_STATUS_CODE = 4008;

export class AGServerSocket extends AsyncStreamEmitter<any>
{
    static CONNECTING: SocketState    = 'connecting';
    static OPEN: SocketState          = 'open';
    static CLOSED: SocketState        = 'closed';
    static AUTHENTICATED: AuthState   = 'authenticated';
    static UNAUTHENTICATED: AuthState = 'unauthenticated';

    static ignoreStatuses: SocketProtocolIgnoreStatuses = socketProtocolIgnoreStatuses;
    static errorStatuses: SocketProtocolErrorStatuses   = socketProtocolErrorStatuses;

    id: string;
    server: AGServer;
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
    private _batchingIntervalId: null;
    private _cid: number;
    private readonly _callbackMap: {[key: string]: any};
    private readonly _sendPing: () => void;
    private _pingTimeoutTicker: number;

    /**
     * Constructor
     */
    constructor(id: string, server: AGServer, socket: WebSocket, protocolVersion: number)
    {
        super();
        this.id              = id;
        this.server          = server;
        this.socket          = socket;
        this.state           = AGServerSocket.CONNECTING;
        this.authState       = AGServerSocket.UNAUTHENTICATED;
        this.protocolVersion = protocolVersion;

        this._receiverDemux  = new StreamDemux();
        this._procedureDemux = new StreamDemux();

        this.request = this.socket['upgradeReq'];

        this.inboundReceivedMessageCount  = 0;
        this.inboundProcessedMessageCount = 0;

        this.outboundPreparedMessageCount = 0;
        this.outboundSentMessageCount     = 0;

        this.cloneData = this.server.options.cloneData;

        this.inboundMessageStream = new WritableConsumableStream();
        this.outboundPacketStream = new WritableConsumableStream();

        this.middlewareHandshakeStream = this.request[this.server.SYMBOL_MIDDLEWARE_HANDSHAKE_STREAM];

        this.middlewareInboundRawStream      = new WritableConsumableStream();
        this.middlewareInboundRawStream.type = this.server.MIDDLEWARE_INBOUND_RAW;

        this.middlewareInboundStream      = new WritableConsumableStream();
        this.middlewareInboundStream.type = this.server.MIDDLEWARE_INBOUND;

        this.middlewareOutboundStream      = new WritableConsumableStream();
        this.middlewareOutboundStream.type = this.server.MIDDLEWARE_OUTBOUND;

        if (this.request['connection'])
        {
            this.remoteAddress = this.request['connection'].remoteAddress;
            this.remoteFamily  = this.request['connection'].remoteFamily;
            this.remotePort    = this.request['connection'].remotePort;
        }
        else
        {
            this.remoteAddress = this.request.remoteAddress;
            this.remoteFamily  = this.request.remoteFamily;
            this.remotePort    = this.request.remotePort;
        }
        if (this.request.forwardedForAddress)
        {
            this.forwardedForAddress = this.request.forwardedForAddress;
        }

        this.isBufferingBatch         = false;
        this.isBatching               = false;
        this.batchOnHandshake         = this.server.options.batchOnHandshake;
        this.batchOnHandshakeDuration = this.server.options.batchOnHandshakeDuration;
        this.batchInterval            = this.server.options.batchInterval;
        this._batchBuffer             = [];

        this._batchingIntervalId = null;
        this._cid                = 1;
        this._callbackMap        = {};

        this.channelSubscriptions      = {};
        this.channelSubscriptionsCount = 0;

        this._on('error', async (err) =>
        {
            this.emitError(err);
        });

        this._on('close', async (code, reasonBuffer) =>
        {
            let reason = reasonBuffer.toString();
            this._destroy(code, reason);
        });

        let pongMessage;
        if (this.protocolVersion === 1)
        {
            pongMessage    = '#2';
            this._sendPing = () =>
            {
                if (this.state !== AGServerSocket.CLOSED)
                {
                    this.send('#1');
                }
            };
        }
        else
        {
            pongMessage    = '';
            this._sendPing = () =>
            {
                if (this.state !== AGServerSocket.CLOSED)
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

            let isPong = message === pongMessage;

            if (isPong)
            {
                this._resetPongTimeout();
            }

            if (this.server.hasMiddleware(this.server.MIDDLEWARE_INBOUND_RAW))
            {
                let action    = new AGAction();
                action.socket = this;
                action.type   = AGAction.MESSAGE;
                action.data   = message;

                try
                {
                    let { data } = await this.server._processMiddlewareAction(this.middlewareInboundRawStream, action, this);
                    message      = data;
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
        return this.inboundReceivedMessageCount - this.inboundProcessedMessageCount;
    }

    getOutboundBackpressure(): number
    {
        return this.outboundPreparedMessageCount - this.outboundSentMessageCount;
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

    emit(eventName: 'message'|'raw', data: {message: {data: any; type: string; target: WebSocket}}): void;
    emit(eventName: 'error', data: {error: Error}): void;
    emit(eventName: 'authStateChange', data: StateChangeData): void;
    emit(eventName: 'authenticate', data: AuthenticateData): void;
    emit(eventName: 'authTokenSigned', data: {signedAuthToken: string}): void;
    emit(eventName: 'deauthenticate', data: DeauthenticateData): void;
    emit(eventName: 'badAuthToken', data: BadAuthTokenData): void;
    emit(eventName: 'connect', data: ConnectData): void;
    emit(eventName: 'subscribe', data: SubscribeData): void;
    emit(eventName: 'unsubscribe', data: UnsubscribeData): void;
    emit(eventName: 'connectAbort', data: ConnectAbortData): void;
    emit(eventName: 'disconnect', data: DisconnectData): void;
    emit(eventName: 'close', data: CloseData): void;
    emit(eventName: 'message'|'raw'): ConsumableStream<{message: {data: any; type: string; target: WebSocket}}>;
    emit(eventName: 'error'): ConsumableStream<{error: Error}>;
    emit(eventName: 'authStateChange'): ConsumableStream<StateChangeData>;
    emit(eventName: 'authenticate'): ConsumableStream<AuthenticateData>;
    emit(eventName: 'authTokenSigned'): ConsumableStream<{signedAuthToken: string}>;
    emit(eventName: 'deauthenticate'): ConsumableStream<DeauthenticateData>;
    emit(eventName: 'badAuthToken'): ConsumableStream<BadAuthTokenData>;
    emit(eventName: 'connect'): ConsumableStream<ConnectData>;
    emit(eventName: 'subscribe'): ConsumableStream<SubscribeData>;
    emit(eventName: 'unsubscribe'): ConsumableStream<UnsubscribeData>;
    emit(eventName: 'connectAbort'): ConsumableStream<ConnectAbortData>;
    emit(eventName: 'disconnect'): ConsumableStream<DisconnectData>;
    emit(eventName: 'close'): ConsumableStream<CloseData>;
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
            let err = new InvalidArgumentsError('If specified, the code argument must be a number');
            this.emitError(err);
        }

        if (this.state !== AGServerSocket.CLOSED)
        {
            await this._destroy(code, reason);
            this.socket.close(code, reason);
        }
    }

    terminate(): void
    {
        if (isFunction(this.socket['terminate']))
        {
            this.socket['terminate']();
        }
    }

    send(data: any, options: {mask?: boolean; binary?: boolean; compress?: boolean; fin?: boolean}): void
    {
        if (isNode())
        {
            this.socket.send(data, options, (error) =>
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
        this._batchBuffer     = [];
    }

    // -----------------------------------------------------------------------------------------------------
    // @ Private methods
    // -----------------------------------------------------------------------------------------------------

    private async _destroy(code?: number, reason?: string): Promise<void>
    {
        clearInterval(this._pingIntervalTicker);
        clearTimeout(this._pingTimeoutTicker);

        this._cancelBatching();

        if (this.state === AGServerSocket.CLOSED)
        {
            this._abortAllPendingEventsDueToBadConnection('connectAbort');
        }
        else
        {
            if (!reason && AGServerSocket.errorStatuses[code])
            {
                reason = AGServerSocket.errorStatuses[code];
            }
            let prevState = this.state;
            this.state    = AGServerSocket.CLOSED;
            if (prevState === AGServerSocket.CONNECTING)
            {
                this._abortAllPendingEventsDueToBadConnection('connectAbort');
                this.emit('connectAbort', { code, reason });
                this.server.emit('connectionAbort', {
                    socket: this,
                    code,
                    reason
                });
            }
            else
            {
                this._abortAllPendingEventsDueToBadConnection('disconnect');
                this.emit('disconnect', { code, reason });
                this.server.emit('disconnection', {
                    socket: this,
                    code,
                    reason
                });
            }

            this.emit('close', { code, reason });
            this.server.emit('closure', {
                socket: this,
                code,
                reason
            });

            clearTimeout(this._handshakeTimeoutRef);
            let isClientFullyConnected = !!this.server.clients[this.id];

            if (isClientFullyConnected)
            {
                delete this.server.clients[this.id];
                this.server.clientsCount--;
            }

            let isClientPending = !!this.server.pendingClients[this.id];
            if (isClientPending)
            {
                delete this.server.pendingClients[this.id];
                this.server.pendingClientsCount--;
            }

            if (!AGServerSocket.ignoreStatuses[code])
            {
                let closeMessage;
                if (reason)
                {
                    let reasonString;
                    if (typeof reason === 'object')
                    {
                        try
                        {
                            reasonString = JSON.stringify(reason);
                        }
                        catch (error)
                        {
                            reasonString = reason.toString();
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
                let err = new SocketProtocolError(AGServerSocket.errorStatuses[code] || closeMessage, code);
                this.emitError(err);
            }

            await this._unsubscribeFromAllChannels();

            let cleanupMode = this.server.options.socketStreamCleanupMode;
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

    private _abortAllPendingEventsDueToBadConnection(failureType: string): void
    {
        Object.keys(this._callbackMap || {}).forEach((i) =>
        {
            let eventObject = this._callbackMap[i];
            delete this._callbackMap[i];

            clearTimeout(eventObject.timeout);
            delete eventObject.timeout;

            let errorMessage       = `Event "${eventObject.event}" was aborted due to a bad connection`;
            let badConnectionError = new BadConnectionError(errorMessage, failureType);

            let callback = eventObject.callback;
            delete eventObject.callback;

            callback.call(eventObject, badConnectionError, eventObject);
        });
    }

    private async _handleInboundMessageStream(pongMessage): Promise<void>
    {
        for await (let message of this.inboundMessageStream)
        {
            this.inboundProcessedMessageCount++;
            let isPong = message === pongMessage;

            if (isPong)
            {
                if (this.server.strictHandshake && this.state === AGServerSocket.CONNECTING)
                {
                    this._destroy(4009);
                    this.socket.close(4009);
                    continue;
                }
                let token = this.getAuthToken();
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
                if (error.name === 'Error')
                {
                    error.name = 'InvalidMessageError';
                }
                this.emitError(error);
                if (this.server.strictHandshake && this.state === this.CONNECTING)
                {
                    this._destroy(4009);
                    this.socket.close(4009);
                }
                continue;
            }

            if (Array.isArray(packet))
            {
                let len = packet.length;
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

    private async _processHandshakeRequest(request: AGRequest): Promise<void>
    {
        let data            = request.data || {};
        let signedAuthToken = data.authToken || null;
        clearTimeout(this._handshakeTimeoutRef);

        let authInfo = await this._validateAuthToken(signedAuthToken);

        let action     = new AGAction();
        action.request = this.request;
        action.socket  = this;
        action.type    = AGAction.HANDSHAKE_SC;
        action.data    = authInfo;

        try
        {
            await this.server._processMiddlewareAction(this.middlewareHandshakeStream, action);
        }
        catch (error)
        {
            if (error.statusCode == null)
            {
                error.statusCode = HANDSHAKE_REJECTION_STATUS_CODE;
            }
            request.error(error);
            this.disconnect(error.statusCode);
            return;
        }

        let clientSocketStatus = {
            id         : this.id,
            pingTimeout: this.server.pingTimeout
        };
        let serverSocketStatus = {
            id         : this.id,
            pingTimeout: this.server.pingTimeout
        };

        let oldAuthState = this.authState;
        try
        {
            await this._processAuthentication(authInfo);
            if (this.state === this.CLOSED)
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
                serverSocketStatus.authError = error;

                if (error.isBadToken)
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

        this.state = this.OPEN;

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

    private async _processAuthenticateRequest(request: AGRequest): Promise<void>
    {
        let signedAuthToken = request.data;
        let oldAuthState    = this.authState;
        let authInfo        = await this._validateAuthToken(signedAuthToken);
        try
        {
            await this._processAuthentication(authInfo);
        }
        catch (error)
        {
            if (error.isBadToken)
            {
                this.deauthenticate();
                request.error(error);

                return;
            }

            request.end({
                isAuthenticated: !!this.authToken,
                authError      : signedAuthToken == null ? null : dehydrateError(error)
            });

            return;
        }
        this.triggerAuthenticationEvents(oldAuthState);
        request.end({
            isAuthenticated: !!this.authToken,
            authError      : null
        });
    }

    private async _subscribeSocket(channelName: string, subscriptionOptions: SubscriptionOptions): Promise<void>
    {
        if (channelName === undefined || !subscriptionOptions)
        {
            throw new InvalidActionError(`Socket ${this.id} provided a malformated channel payload`);
        }

        if (this.server.socketChannelLimit && this.channelSubscriptionsCount >= this.server.socketChannelLimit)
        {
            throw new InvalidActionError(
                `Socket ${this.id} tried to exceed the channel subscription limit of ${this.server.socketChannelLimit}`
            );
        }

        if (typeof channelName !== 'string')
        {
            throw new InvalidActionError(`Socket ${this.id} provided an invalid channel name`);
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
            subscriptionOptions
        });
        this.server.emit('subscription', {
            socket : this,
            channel: channelName,
            subscriptionOptions
        });
    }

    private async _processSubscribeRequest(request: AGRequest): Promise<void>
    {
        let subscriptionOptions = Object.assign({}, request.data);
        let channelName         = subscriptionOptions.channel;
        delete subscriptionOptions.channel;

        if (this.state === this.OPEN)
        {
            try
            {
                await this._subscribeSocket(channelName, subscriptionOptions);
            }
            catch (err)
            {
                let error = new BrokerError(`Failed to subscribe socket to the ${channelName} channel - ${err}`);
                this.emitError(error);
                request.error(error);

                return;
            }

            request.end();

            return;
        }
        // This is an invalid state; it means the client tried to subscribe before
        // having completed the handshake.
        let error = new InvalidActionError('Cannot subscribe socket to a channel before it has completed the handshake');
        this.emitError(error);
        request.error(error);
    }

    private _unsubscribeFromAllChannels(): Promise<any>
    {
        const channels = Object.keys(this.channelSubscriptions);
        return Promise.all(channels.map((channel) => this._unsubscribe(channel)));
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

    private async _processUnsubscribePacket(packet: EventObject): Promise<void>
    {
        let channel = packet.data;
        try
        {
            await this._unsubscribe(channel);
        }
        catch (err)
        {
            let error = new BrokerError(
                `Failed to unsubscribe socket from the ${channel} channel - ${err}`
            );
            this.emitError(error);
        }
    }

    private async _processUnsubscribeRequest(request: AGRequest): Promise<void>
    {
        let channel = request.data;
        try
        {
            await this._unsubscribe(channel);
        }
        catch (err)
        {
            let error = new BrokerError(
                `Failed to unsubscribe socket from the ${channel} channel - ${err}`
            );
            this.emitError(error);
            request.error(error);
            return;
        }
        request.end();
    }

    private async _processInboundPublishPacket(packet: EventObject): Promise<void>
    {
        let data = packet.data || {};
        if (typeof data.channel !== 'string')
        {
            let error = new InvalidActionError(`Socket ${this.id} tried to invoke publish to an invalid "${data.channel}" channel`);
            this.emitError(error);
            return;
        }
        try
        {
            await this.server.exchange.invokePublish(data.channel, data.data);
        }
        catch (error)
        {
            this.emitError(error);
        }
    }

    private async _processInboundPublishRequest(request: AGRequest): Promise<void>
    {
        let data = request.data || {};
        if (typeof data.channel !== 'string')
        {
            let error = new InvalidActionError(`Socket ${this.id} tried to transmit publish to an invalid "${data.channel}" channel`);
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
            this.emitError(error);
            request.error(error);
            return;
        }
        request.end();
    }

    private async _processInboundPacket(packet: EventObject, message): Promise<void>
    {
        if (packet && packet.event != null)
        {
            let eventName = packet.event;
            let isRPC     = packet.cid != null;

            if (eventName === '#handshake')
            {
                let request = new AGRequest(this, packet.cid, eventName, packet.data);
                await this._processHandshakeRequest(request);
                this._procedureDemux.write(eventName, request);

                return;
            }
            if (this.server.strictHandshake && this.state === this.CONNECTING)
            {
                this._destroy(4009);
                this.socket.close(4009);

                return;
            }
            if (eventName === '#authenticate')
            {
                // Let AGServer handle these events.
                let request = new AGRequest(this, packet.cid, eventName, packet.data);
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

            let action    = new AGAction();
            action.socket = this;

            let tokenExpiredError = this._processAuthTokenExpiry();
            if (tokenExpiredError)
            {
                action.authTokenExpiredError = tokenExpiredError;
            }

            let isPublish     = eventName === '#publish';
            let isSubscribe   = eventName === '#subscribe';
            let isUnsubscribe = eventName === '#unsubscribe';

            if (isPublish)
            {
                if (!this.server.allowClientPublish)
                {
                    let error = new InvalidActionError('Client publish feature is disabled');
                    this.emitError(error);

                    if (isRPC)
                    {
                        let request = new AGRequest(this, packet.cid, eventName, packet.data);
                        request.error(error);
                    }
                    return;
                }
                action.type = AGAction.PUBLISH_IN;
                if (packet.data)
                {
                    action.channel = packet.data.channel;
                    action.data    = packet.data.data;
                }
            }
            else if (isSubscribe)
            {
                action.type = AGAction.SUBSCRIBE;
                if (packet.data)
                {
                    action.channel = packet.data.channel;
                    action.data    = packet.data.data;
                }
            }
            else if (isUnsubscribe)
            {
                if (isRPC)
                {
                    let request = new AGRequest(this, packet.cid, eventName, packet.data);
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
                    action.type      = AGAction.INVOKE;
                    action.procedure = packet.event;
                    if (packet.data !== undefined)
                    {
                        action.data = packet.data;
                    }
                }
                else
                {
                    action.type     = AGAction.TRANSMIT;
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
                let request = new AGRequest(this, packet.cid, eventName, packet.data);
                try
                {
                    let { data } = await this.server._processMiddlewareAction(this.middlewareInboundStream, action, this);
                    newData      = data;
                }
                catch (error)
                {
                    request.error(error);

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
                let { data } = await this.server._processMiddlewareAction(this.middlewareInboundStream, action, this);
                newData      = data;
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

        if (this.server.strictHandshake && this.state === AGServerSocket.CONNECTING)
        {
            this._destroy(4009);
            this.socket.close(4009);

            return;
        }

        if (packet && packet.rid != null)
        {
            // If incoming message is a response to a previously sent message
            let ret = this._callbackMap[packet.rid];
            if (ret)
            {
                clearTimeout(ret.timeout);
                delete this._callbackMap[packet.rid];
                let rehydratedError = scErrors.hydrateError(packet.error);
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
    private _on(event: 'message', cb: (messageBuffer: any, isBinary: boolean) => Promise<any>): void
    private _on(event: 'close', cb: (code, reasonBuffer: any) => Promise<any>): void
    private _on(event: 'error', cb: (error: any) => Promise<any>): void
    private _on(event: 'message'|'close'|'error', cb: (arg1: any, arg2?: any) => Promise<any>): void
    {
        if (isNode())
        {
            this.socket['on'](event, cb);
        }
        else
        {
            switch (event)
            {
                case 'message':
                    this.socket['addEventListener'](event, (event) => cb(event.data));
                    break;
                case 'close':
                case 'error':
                    this.socket['addEventListener'](event, (event) => cb(event));
                    break
            }
        }
    }
}
