import Buffer from 'topgun-buffer';
import { AsyncStreamEmitter } from '../async-stream-emitter';
import { TGChannel } from '../channel/channel';
import { ChannelState } from '../channel/channel-state';
import { TGChannelClient } from '../channel/client';
import {
    BadConnectionError,
    hydrateError,
    InvalidArgumentsError,
    InvalidMessageError,
    SocketProtocolError,
    socketProtocolErrorStatuses,
    socketProtocolIgnoreStatuses,
    TimeoutError,
} from '../errors/errors';
import {
    SocketProtocolErrorStatuses,
    SocketProtocolIgnoreStatuses,
} from '../errors/types';
import { formatter } from '../formatter';
import { Item, LinkedList } from '../linked-list';
import { StreamDemux } from '../stream-demux';
import { DemuxedConsumableStream } from '../stream-demux/demuxed-consumable-stream';
import { AuthToken, CodecEngine, EventObject, UnsubscribeData } from '../types';
import { cloneDeep } from '../utils/clone-deep';
import { getGlobal } from '../utils/global';
import { wait } from '../utils/wait';
import { ConsumerStats } from '../writable-consumable-stream/consumer-stats';
import { AuthEngine } from './auth';
import { TGTransport } from './transport';
import {
    AuthStates,
    AuthStatus,
    ClientOptions,
    KickOutData,
    ProtocolVersions,
    SignedAuthToken,
    States,
    SubscribeFailData,
    SubscribeOptions,
    TGAuthEngine,
    TransmitOptions,
} from './types';
import { TGRequest } from '../request';

const isBrowser = typeof window !== 'undefined';
const global    = getGlobal();

/* eslint-disable @typescript-eslint/no-unused-vars */
export class TGClientSocket
    extends AsyncStreamEmitter<any>
    implements TGChannelClient
{
    static readonly CONNECTING: States = 'connecting';
    static readonly OPEN: States       = 'open';
    static readonly CLOSED: States     = 'closed';

    static readonly AUTHENTICATED: AuthStates   = 'authenticated';
    static readonly UNAUTHENTICATED: AuthStates = 'unauthenticated';

    static readonly SUBSCRIBED   = 'subscribed';
    static readonly PENDING      = 'pending';
    static readonly UNSUBSCRIBED = 'unsubscribed';

    static readonly ignoreStatuses: SocketProtocolIgnoreStatuses =
                        socketProtocolIgnoreStatuses;
    static readonly errorStatuses: SocketProtocolErrorStatuses   =
                        socketProtocolErrorStatuses;

    options: ClientOptions;

    id: string|null;
    clientId?: string|undefined;

    version: string|null;
    protocolVersion: ProtocolVersions;

    state: States;

    authState: AuthStates;
    signedAuthToken: SignedAuthToken|null;
    authToken: AuthToken|null;
    authTokenName: string;

    wsOptions?: ClientOptions|undefined;

    pendingReconnect: boolean;
    pendingReconnectTimeout: number;

    preparingPendingSubscriptions: boolean;

    ackTimeout: number;
    connectTimeout: number;

    pingTimeout: number;
    pingTimeoutDisabled: boolean;

    channelPrefix: string|null;
    disconnectOnUnload: boolean;

    connectAttempts: number;

    isBatching: boolean;
    batchOnHandshake: boolean;
    batchOnHandshakeDuration: number;

    auth: TGAuthEngine;
    codec: CodecEngine;
    transport?: TGTransport|undefined;

    poolIndex?: number|undefined;
    private _batchingIntervalId: any;
    private _outboundBuffer: LinkedList<any>;
    private _channelMap: {[key: string]: any};
    private _channelEventDemux: StreamDemux<unknown>;
    private _channelDataDemux: StreamDemux<unknown>;
    private _receiverDemux: StreamDemux<unknown>;
    private _procedureDemux: StreamDemux<unknown>;
    private _cid: number;
    private _reconnectTimeoutRef: any;

    private _privateDataHandlerMap: {
        [key: string]: (...params: any[]) => void;
    } = {
        '#publish'        : (data: any) =>
        {
            const undecoratedChannelName = this._undecorateChannelName(
                data.channel
            );
            const isSubscribed           = this.isSubscribed(undecoratedChannelName, true);

            if (isSubscribed)
            {
                this._channelDataDemux.write(undecoratedChannelName, data.data);
            }
        },
        '#kickOut'        : (data: any) =>
        {
            const undecoratedChannelName = this._undecorateChannelName(
                data.channel
            );
            const channel                = this._channelMap[undecoratedChannelName];
            if (channel)
            {
                this.emit('kickOut', {
                    channel: undecoratedChannelName,
                    message: data.message,
                } as KickOutData);
                this._channelEventDemux.write(
                    `${undecoratedChannelName}/kickOut`,
                    { message: data.message }
                );
                this._triggerChannelUnsubscribe(channel);
            }
        },
        '#setAuthToken'   : (data: any) =>
        {
            if (data)
            {
                this._setAuthToken(data);
            }
        },
        '#removeAuthToken': (data: any) =>
        {
            this._removeAuthToken();
        },
    };

    private _privateRPCHandlerMap: {
        [key: string]: (...params: any[]) => void;
    } = {
        '#setAuthToken'   : (data: any, request: any) =>
        {
            if (data)
            {
                this._setAuthToken(data);

                request.end();
            }
            else
            {
                request.error(
                    new InvalidMessageError(
                        'No token data provided by #setAuthToken event'
                    )
                );
            }
        },
        '#removeAuthToken': (data: any, request: any) =>
        {
            this._removeAuthToken();
            request.end();
        },
    };

    /**
     * Constructor
     */
    constructor(socketOptions: ClientOptions)
    {
        super();

        const defaultOptions: ClientOptions = {
            path                    : '/topgunsocket/',
            secure                  : false,
            protocolScheme          : null,
            socketPath              : null,
            autoConnect             : true,
            autoReconnect           : true,
            autoSubscribeOnConnect  : true,
            connectTimeout          : 20000,
            ackTimeout              : 10000,
            timestampRequests       : false,
            timestampParam          : 't',
            authTokenName           : 'topgunsocket.authToken',
            binaryType              : 'arraybuffer',
            batchOnHandshake        : false,
            batchOnHandshakeDuration: 100,
            batchInterval           : 50,
            protocolVersion         : 2,
            wsOptions               : {},
            cloneData               : false,
        };
        const opts: ClientOptions           = Object.assign(
            defaultOptions,
            socketOptions
        );

        this.id                            = null;
        this.version                       = opts.version || null;
        this.protocolVersion               = opts.protocolVersion as ProtocolVersions;
        this.state                         = TGClientSocket.CLOSED;
        this.authState                     = TGClientSocket.UNAUTHENTICATED;
        this.signedAuthToken               = null;
        this.authToken                     = null;
        this.pendingReconnect              = false;
        this.pendingReconnectTimeout       = null;
        this.preparingPendingSubscriptions = false;
        this.clientId                      = opts.clientId;
        this.wsOptions                     = opts.wsOptions;

        this.connectTimeout     = opts.connectTimeout;
        this.ackTimeout         = opts.ackTimeout;
        this.channelPrefix      = opts.channelPrefix || null;
        this.disconnectOnUnload =
            opts.disconnectOnUnload == null ? true : opts.disconnectOnUnload;
        this.authTokenName      = opts.authTokenName;

        // pingTimeout will be connectTimeout at the start, but it will
        // be updated with values provided by the 'connect' event
        opts.pingTimeout         = opts.connectTimeout;
        this.pingTimeout         = opts.pingTimeout;
        this.pingTimeoutDisabled = !!opts.pingTimeoutDisabled;

        const maxTimeout = Math.pow(2, 31) - 1;

        const verifyDuration = (propertyName: string) =>
        {
            if ((this as any)[propertyName] > maxTimeout)
            {
                throw new InvalidArgumentsError(
                    `The ${propertyName} value provided exceeded the maximum amount allowed`
                );
            }
        };

        verifyDuration('connectTimeout');
        verifyDuration('ackTimeout');
        verifyDuration('pingTimeout');

        this.connectAttempts = 0;

        this.isBatching               = false;
        this.batchOnHandshake         = opts.batchOnHandshake;
        this.batchOnHandshakeDuration = opts.batchOnHandshakeDuration;

        this._batchingIntervalId = null;
        this._outboundBuffer     = new LinkedList();
        this._channelMap         = {};

        this._channelEventDemux = new StreamDemux();
        this._channelDataDemux  = new StreamDemux();

        this._receiverDemux  = new StreamDemux();
        this._procedureDemux = new StreamDemux();

        this.options = opts;

        this._cid = 1;

        this.options.callIdGenerator = () =>
        {
            return this._cid++;
        };

        if (this.options.autoReconnect)
        {
            if (this.options.autoReconnectOptions == null)
            {
                this.options.autoReconnectOptions = {};
            }

            // Add properties to the this.options.autoReconnectOptions object.
            // We assign the reference to a reconnectOptions variable to avoid repetition.
            const reconnectOptions = this.options.autoReconnectOptions;
            if (reconnectOptions.initialDelay == null)
            {
                reconnectOptions.initialDelay = 10000;
            }
            if (reconnectOptions.randomness == null)
            {
                reconnectOptions.randomness = 10000;
            }
            if (reconnectOptions.multiplier == null)
            {
                reconnectOptions.multiplier = 1.5;
            }
            if (reconnectOptions.maxDelay == null)
            {
                reconnectOptions.maxDelay = 60000;
            }
        }

        if (this.options.subscriptionRetryOptions == null)
        {
            this.options.subscriptionRetryOptions = {};
        }

        if (this.options.authEngine)
        {
            this.auth = this.options.authEngine;
        }
        else
        {
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

        if ((this.options as any)['protocol'])
        {
            const protocolOptionError = new InvalidArgumentsError(
                'The "protocol" option does not affect socketcluster-client - ' +
                'If you want to utilize SSL/TLS, use "secure" option instead'
            );
            this._onError(protocolOptionError);
        }

        this.options.query = opts.query || {};
        if (typeof this.options.query === 'string')
        {
            const searchParams                      = new URLSearchParams(this.options.query);
            const queryObject: {[key: string]: any} = {};

            searchParams.forEach((value, key) =>
            {
                const currentValue = queryObject[key];
                if (currentValue == null)
                {
                    queryObject[key] = value;
                }
                else
                {
                    if (!Array.isArray(currentValue))
                    {
                        queryObject[key] = [currentValue];
                    }
                    queryObject[key].push(value);
                }
            });

            this.options.query = queryObject;
        }

        if (
            isBrowser &&
            this.disconnectOnUnload &&
            global.addEventListener &&
            global.removeEventListener
        )
        {
            this._handleBrowserUnload();
        }

        if (this.options.autoConnect)
        {
            this.connect();
        }
    }

    // -----------------------------------------------------------------------------------------------------
    // @ Accessors
    // -----------------------------------------------------------------------------------------------------

    get isBufferingBatch(): boolean
    {
        return this.transport.isBufferingBatch;
    }

    // -----------------------------------------------------------------------------------------------------
    // @ Public methods
    // -----------------------------------------------------------------------------------------------------

    getBackpressure(): number
    {
        return Math.max(
            this.getAllListenersBackpressure(),
            this.getAllReceiversBackpressure(),
            this.getAllProceduresBackpressure(),
            this.getAllChannelsBackpressure()
        );
    }

    getState(): States
    {
        return this.state;
    }

    getBytesReceived(): any
    {
        return this.transport.getBytesReceived();
    }

    async deauthenticate(): Promise<void>
    {
        (async () =>
        {
            let oldAuthToken;
            try
            {
                oldAuthToken = await this.auth.removeToken(this.authTokenName);
            }
            catch (err)
            {
                this._onError(err);
                return;
            }
            this.emit('removeAuthToken', { oldAuthToken });
        })();

        if (this.state !== TGClientSocket.CLOSED)
        {
            this.transmit('#removeAuthToken');
        }
        this._changeToUnauthenticatedStateAndClearTokens();
        await wait(0);
    }

    connect(): void
    {
        if (this.state === TGClientSocket.CLOSED)
        {
            this.pendingReconnect        = false;
            this.pendingReconnectTimeout = null;
            clearTimeout(this._reconnectTimeoutRef);

            this.state = TGClientSocket.CONNECTING;
            this.emit('connecting', {});

            if (this.transport)
            {
                this.transport.clearAllListeners();
            }

            const transportHandlers = {
                onOpen           : (value: any) =>
                {
                    this.state = TGClientSocket.OPEN;
                    this._onOpen(value);
                },
                onOpenAbort      : (value: any) =>
                {
                    if (this.state !== TGClientSocket.CLOSED)
                    {
                        this.state = TGClientSocket.CLOSED;
                        this._destroy(value.code, value.reason, true);
                    }
                },
                onClose          : (value: any) =>
                {
                    if (this.state !== TGClientSocket.CLOSED)
                    {
                        this.state = TGClientSocket.CLOSED;
                        this._destroy(value.code, value.reason);
                    }
                },
                onEvent          : (value: any) =>
                {
                    this.emit(value.event, value.data);
                },
                onError          : (value: any) =>
                {
                    this._onError(value.error);
                },
                onInboundInvoke  : (value: any) =>
                {
                    this._onInboundInvoke(value);
                },
                onInboundTransmit: (value: any) =>
                {
                    this._onInboundTransmit(value.event, value.data);
                },
            };

            this.transport = new TGTransport(
                this.auth,
                this.codec,
                this.options,
                this.wsOptions,
                transportHandlers
            );
        }
    }

    reconnect(code?: number, reason?: string): void
    {
        this.disconnect(code, reason);
        this.connect();
    }

    disconnect(code?: number, reason?: string): void
    {
        code = code || 1000;

        if (typeof code !== 'number')
        {
            throw new InvalidArgumentsError(
                'If specified, the code argument must be a number'
            );
        }

        const isConnecting = this.state === TGClientSocket.CONNECTING;
        if (isConnecting || this.state === TGClientSocket.OPEN)
        {
            this.state = TGClientSocket.CLOSED;
            this._destroy(code, reason, isConnecting);
            this.transport.close(code, reason);
        }
        else
        {
            this.pendingReconnect        = false;
            this.pendingReconnectTimeout = null;
            clearTimeout(this._reconnectTimeoutRef);
        }
    }

    decodeBase64(encodedString: string): string
    {
        return Buffer.from(encodedString, 'base64').toString('utf8');
    }

    encodeBase64(decodedString: string): string
    {
        return Buffer.from(decodedString, 'utf8').toString('base64');
    }

    getAuthToken(): AuthToken|null
    {
        return this.authToken;
    }

    getSignedAuthToken(): SignedAuthToken|null
    {
        return this.signedAuthToken;
    }

    /**
     * Perform client-initiated authentication by providing an encrypted token string.
     */
    async authenticate(signedAuthToken: string): Promise<AuthStatus>
    {
        let authStatus;

        try
        {
            authStatus = await this.invoke('#authenticate', signedAuthToken);
        }
        catch (err)
        {
            if (
                (err as Error).name !== 'BadConnectionError' &&
                (err as Error).name !== 'TimeoutError'
            )
            {
                // In case of a bad/closed connection or a timeout, we maintain the last
                // known auth state since those errors don't mean that the token is invalid.
                this._changeToUnauthenticatedStateAndClearTokens();
            }
            await wait(0);
            throw err;
        }

        if (authStatus && authStatus.isAuthenticated != null)
        {
            // If authStatus is correctly formatted (has an isAuthenticated property),
            // then we will rehydrate the authError.
            if (authStatus.authError)
            {
                authStatus.authError = hydrateError(authStatus.authError);
            }
        }
        else
        {
            // Some errors like BadConnectionError and TimeoutError will not pass a valid
            // authStatus object to the current function, so we need to create it ourselves.
            authStatus = {
                isAuthenticated: this.authState,
                authError      : null,
            };
        }

        if (authStatus.isAuthenticated)
        {
            this._changeToAuthenticatedState(signedAuthToken);
        }
        else
        {
            this._changeToUnauthenticatedStateAndClearTokens();
        }

        (async () =>
        {
            try
            {
                await this.auth.saveToken(
                    this.authTokenName,
                    signedAuthToken,
                    {}
                );
            }
            catch (err)
            {
                this._onError(err);
            }
        })();

        await wait(0);
        return authStatus;
    }

    decode(message: any): any
    {
        return this.transport.decode(message);
    }

    encode(object: any): any
    {
        return this.transport.encode(object);
    }

    send(data: any): void
    {
        this.transport.send(data);
    }

    transmit(
        event: string,
        data?: any,
        options?: {ackTimeout?: number|undefined}
    ): Promise<void>
    {
        return this._processOutboundEvent(event, data, options);
    }

    invoke(
        event: string,
        data: any,
        options?: {ackTimeout?: number|undefined}
    ): Promise<any>
    {
        return this._processOutboundEvent(event, data, options, true);
    }

    transmitPublish(channelName: string, data: any): Promise<void>
    {
        const pubData = {
            channel: this._decorateChannelName(channelName),
            data,
        };
        return this.transmit('#publish', pubData);
    }

    invokePublish(
        channelName: string,
        data: any
    ): Promise<{channel: string; data: any}>
    {
        const pubData = {
            channel: this._decorateChannelName(channelName),
            data,
        };
        return this.invoke('#publish', pubData);
    }

    startBatch(): void
    {
        this.transport.startBatch();
    }

    flushBatch(): void
    {
        this.transport.flushBatch();
    }

    cancelBatch(): void
    {
        this.transport.cancelBatch();
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

    subscribe(channelName: string, options?: SubscribeOptions): TGChannel<any>
    {
        options     = options || {};
        let channel = this._channelMap[channelName];

        const sanitizedOptions: SubscribeOptions = {
            waitForAuth: !!options.waitForAuth,
        };

        if (options.priority != null)
        {
            sanitizedOptions.priority = options.priority;
        }
        if (options.data !== undefined)
        {
            sanitizedOptions.data = options.data;
        }

        if (!channel)
        {
            channel                       = {
                name   : channelName,
                state  : TGChannel.PENDING,
                options: sanitizedOptions,
            };
            this._channelMap[channelName] = channel;
            this._trySubscribe(channel);
        }
        else if (options)
        {
            channel.options = sanitizedOptions;
        }

        const channelIterable = new TGChannel(
            channelName,
            this,
            this._channelEventDemux,
            this._channelDataDemux
        );

        return channelIterable;
    }

    async unsubscribe(channelName: string): Promise<void>
    {
        const channel = this._channelMap[channelName];

        if (channel)
        {
            this._triggerChannelUnsubscribe(channel);
            this._tryUnsubscribe(channel);
        }
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

    // ---- Channel logic ----

    channel(channelName: string): TGChannel<any>
    {
        // let currentChannel = this._channelMap[channelName];

        const channelIterable = new TGChannel(
            channelName,
            this,
            this._channelEventDemux,
            this._channelDataDemux
        );

        return channelIterable;
    }

    closeChannel(channelName: string): void
    {
        this.channelCloseOutput(channelName);
        this.channelCloseAllListeners(channelName);
    }

    closeAllChannelOutputs(): void
    {
        this._channelDataDemux.closeAll();
    }

    closeAllChannelListeners(): void
    {
        this._channelEventDemux.closeAll();
    }

    closeAllChannels(): void
    {
        this.closeAllChannelOutputs();
        this.closeAllChannelListeners();
    }

    killChannel(channelName: string): void
    {
        this.channelKillOutput(channelName);
        this.channelKillAllListeners(channelName);
    }

    killAllChannelOutputs(): void
    {
        this._channelDataDemux.killAll();
    }

    killAllChannelListeners(): void
    {
        this._channelEventDemux.killAll();
    }

    killAllChannels(): void
    {
        this.killAllChannelOutputs();
        this.killAllChannelListeners();
    }

    killChannelOutputConsumer(consumerId: number): void
    {
        this._channelDataDemux.killConsumer(consumerId);
    }

    killChannelListenerConsumer(consumerId: number): void
    {
        this._channelEventDemux.killConsumer(consumerId);
    }

    getChannelOutputConsumerStats(consumerId: number): ConsumerStats
    {
        return this._channelDataDemux.getConsumerStats(consumerId);
    }

    getChannelListenerConsumerStats(consumerId: number): ConsumerStats
    {
        return this._channelEventDemux.getConsumerStats(consumerId);
    }

    getAllChannelOutputsConsumerStatsList(): any[]
    {
        return this._channelDataDemux.getConsumerStatsListAll();
    }

    getAllChannelListenersConsumerStatsList(): any[]
    {
        return this._channelEventDemux.getConsumerStatsListAll();
    }

    getChannelBackpressure(channelName: string): number
    {
        return Math.max(
            this.channelGetOutputBackpressure(channelName),
            this.channelGetAllListenersBackpressure(channelName)
        );
    }

    getAllChannelOutputsBackpressure(): number
    {
        return this._channelDataDemux.getBackpressureAll();
    }

    getAllChannelListenersBackpressure(): number
    {
        return this._channelEventDemux.getBackpressureAll();
    }

    getAllChannelsBackpressure(): number
    {
        return Math.max(
            this.getAllChannelOutputsBackpressure(),
            this.getAllChannelListenersBackpressure()
        );
    }

    getChannelListenerConsumerBackpressure(consumerId: number): number
    {
        return this._channelEventDemux.getConsumerBackpressure(consumerId);
    }

    getChannelOutputConsumerBackpressure(consumerId: number): number
    {
        return this._channelDataDemux.getConsumerBackpressure(consumerId);
    }

    hasAnyChannelOutputConsumer(consumerId: any): boolean
    {
        return this._channelDataDemux.hasConsumerAll(consumerId);
    }

    hasAnyChannelListenerConsumer(consumerId: any): boolean
    {
        return this._channelEventDemux.hasConsumerAll(consumerId);
    }

    getChannelState(channelName: string): ChannelState
    {
        const channel = this._channelMap[channelName];
        if (channel)
        {
            return channel.state;
        }
        return TGChannel.UNSUBSCRIBED;
    }

    getChannelOptions(channelName: string): object
    {
        const channel = this._channelMap[channelName];
        if (channel)
        {
            return { ...channel.options };
        }
        return {};
    }

    channelCloseOutput(channelName: string): void
    {
        this._channelDataDemux.close(channelName);
    }

    channelCloseListener(channelName: string, eventName: string): void
    {
        this._channelEventDemux.close(`${channelName}/${eventName}`);
    }

    channelCloseAllListeners(channelName: string): void
    {
        this._getAllChannelStreamNames(channelName).forEach((streamName) =>
        {
            this._channelEventDemux.close(streamName);
        });
    }

    channelKillOutput(channelName: string): void
    {
        this._channelDataDemux.kill(channelName);
    }

    channelKillListener(channelName: string, eventName: string): void
    {
        this._channelEventDemux.kill(`${channelName}/${eventName}`);
    }

    channelKillAllListeners(channelName: string): void
    {
        this._getAllChannelStreamNames(channelName).forEach((streamName) =>
        {
            this._channelEventDemux.kill(streamName);
        });
    }

    channelGetOutputConsumerStatsList(channelName: string): ConsumerStats[]
    {
        return this._channelDataDemux.getConsumerStatsList(channelName);
    }

    channelGetListenerConsumerStatsList(
        channelName: string,
        eventName: string
    ): ConsumerStats[]
    {
        return this._channelEventDemux.getConsumerStatsList(
            `${channelName}/${eventName}`
        );
    }

    channelGetAllListenersConsumerStatsList(
        channelName: string
    ): ConsumerStats[]
    {
        return this._getAllChannelStreamNames(channelName)
            .map((streamName) =>
            {
                return this._channelEventDemux.getConsumerStatsList(streamName);
            })
            .reduce((accumulator, statsList) =>
            {
                statsList.forEach((stats) =>
                {
                    accumulator.push(stats);
                });
                return accumulator;
            }, []);
    }

    channelGetOutputBackpressure(channelName: string): number
    {
        return this._channelDataDemux.getBackpressure(channelName);
    }

    channelGetListenerBackpressure(
        channelName: string,
        eventName: string
    ): number
    {
        return this._channelEventDemux.getBackpressure(
            `${channelName}/${eventName}`
        );
    }

    channelGetAllListenersBackpressure(channelName: string): number
    {
        const listenerStreamBackpressures = this._getAllChannelStreamNames(
            channelName
        ).map((streamName) =>
        {
            return this._channelEventDemux.getBackpressure(streamName);
        });
        return Math.max(...listenerStreamBackpressures.concat(0));
    }

    channelHasOutputConsumer(channelName: string, consumerId: number): boolean
    {
        return this._channelDataDemux.hasConsumer(channelName, consumerId);
    }

    channelHasListenerConsumer(
        channelName: string,
        eventName: string,
        consumerId: number
    ): boolean
    {
        return this._channelEventDemux.hasConsumer(
            `${channelName}/${eventName}`,
            consumerId
        );
    }

    channelHasAnyListenerConsumer(
        channelName: string,
        consumerId: number
    ): boolean
    {
        return this._getAllChannelStreamNames(channelName).some(
            (streamName) =>
            {
                return this._channelEventDemux.hasConsumer(
                    streamName,
                    consumerId
                );
            }
        );
    }

    subscriptions(includePending?: boolean): string[]
    {
        const subs: string[] = [];
        Object.keys(this._channelMap).forEach((channelName) =>
        {
            if (
                includePending ||
                this._channelMap[channelName].state === TGChannel.SUBSCRIBED
            )
            {
                subs.push(channelName);
            }
        });
        return subs;
    }

    isSubscribed(channelName: string, includePending?: boolean): boolean
    {
        const channel = this._channelMap[channelName];
        if (includePending)
        {
            return !!channel;
        }
        return !!channel && channel.state === TGChannel.SUBSCRIBED;
    }

    processPendingSubscriptions(): void
    {
        this.preparingPendingSubscriptions = false;
        const pendingChannels: any[]       = [];

        Object.keys(this._channelMap).forEach((channelName) =>
        {
            const channel = this._channelMap[channelName];
            if (channel.state === TGChannel.PENDING)
            {
                pendingChannels.push(channel);
            }
        });

        pendingChannels.sort((a, b) =>
        {
            const ap = a.options.priority || 0;
            const bp = b.options.priority || 0;
            if (ap > bp)
            {
                return -1;
            }
            if (ap < bp)
            {
                return 1;
            }
            return 0;
        });

        pendingChannels.forEach((channel) =>
        {
            this._trySubscribe(channel);
        });
    }

    // -----------------------------------------------------------------------------------------------------
    // @ Private methods
    // -----------------------------------------------------------------------------------------------------

    private _getAllChannelStreamNames(channelName: string): string[]
    {
        const streamNamesLookup = this._channelEventDemux
            .getConsumerStatsListAll()
            .filter((stats) =>
            {
                return stats.stream.indexOf(`${channelName}/`) === 0;
            })
            .reduce((accumulator: any, stats: any) =>
            {
                accumulator[stats.stream] = true;
                return accumulator;
            }, {});
        return Object.keys(streamNamesLookup);
    }

    private _tryUnsubscribe(channel: TGChannel<any>): void
    {
        if (this.state === TGClientSocket.OPEN)
        {
            const options: TransmitOptions = {
                noTimeout: true,
            };
            // If there is a pending subscribe action, cancel the callback
            this._cancelPendingSubscribeCallback(channel);

            // This operation cannot fail because the TCP protocol guarantees delivery
            // so long as the connection remains open. If the connection closes,
            // the server will automatically unsubscribe the client and thus complete
            // the operation on the server side.
            const decoratedChannelName = this._decorateChannelName(channel.name);
            this.transport.transmit(
                '#unsubscribe',
                decoratedChannelName,
                options
            );
        }
    }

    private _triggerChannelUnsubscribe(
        channel: TGChannel<any>,
        setAsPending?: boolean
    ): void
    {
        const channelName = channel.name;

        this._cancelPendingSubscribeCallback(channel);

        if (channel.state === TGChannel.SUBSCRIBED)
        {
            const stateChangeData = {
                oldChannelState: channel.state,
                newChannelState: setAsPending
                    ? TGChannel.PENDING
                    : TGChannel.UNSUBSCRIBED,
            };
            this._channelEventDemux.write(
                `${channelName}/subscribeStateChange`,
                stateChangeData
            );
            this._channelEventDemux.write(`${channelName}/unsubscribe`, {});
            this.emit('subscribeStateChange', {
                channel: channelName,
                ...stateChangeData,
            });
            this.emit('unsubscribe', {
                channel: channelName,
            } as UnsubscribeData);
        }

        if (setAsPending)
        {
            channel.state = TGChannel.PENDING;
        }
        else
        {
            delete this._channelMap[channelName];
        }
    }

    private _trySubscribe(channel: TGChannel<any>): void
    {
        const meetsAuthRequirements =
                  !channel.options['waitForAuth'] ||
                  this.authState === TGClientSocket.AUTHENTICATED;

        // We can only ever have one pending subscribe action at any given time on a channel
        if (
            this.state === TGClientSocket.OPEN &&
            !this.preparingPendingSubscriptions &&
            channel._pendingSubscriptionCid == null &&
            meetsAuthRequirements
        )
        {
            const options: {[key: string]: any} = {
                noTimeout: true,
            };

            const subscriptionOptions: {[key: string]: any} = {};
            if (channel.options['waitForAuth'])
            {
                options['waitForAuth']             = true;
                subscriptionOptions['waitForAuth'] = options['waitForAuth'];
            }
            if (channel.options['data'])
            {
                subscriptionOptions['data'] = channel.options['data'];
            }

            channel._pendingSubscriptionCid = this.transport.invokeRaw(
                '#subscribe',
                {
                    channel: this._decorateChannelName(channel.name),
                    ...subscriptionOptions,
                },
                options,
                (err) =>
                {
                    if (err)
                    {
                        if (err.name === 'BadConnectionError')
                        {
                            // In case of a failed connection, keep the subscription
                            // as pending; it will try again on reconnect.
                            return;
                        }
                        delete channel._pendingSubscriptionCid;
                        this._triggerChannelSubscribeFail(
                            err,
                            channel,
                            subscriptionOptions
                        );
                    }
                    else
                    {
                        delete channel._pendingSubscriptionCid;
                        this._triggerChannelSubscribe(
                            channel,
                            subscriptionOptions
                        );
                    }
                }
            );
            this.emit('subscribeRequest', {
                channel: channel.name,
                subscriptionOptions,
            });
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
        }, this.options.batchInterval);
    }

    private _undecorateChannelName(decoratedChannelName: string): string
    {
        if (
            this.channelPrefix &&
            decoratedChannelName.indexOf(this.channelPrefix) === 0
        )
        {
            return decoratedChannelName.replace(this.channelPrefix, '');
        }
        return decoratedChannelName;
    }

    private _decorateChannelName(channelName: string): string
    {
        if (this.channelPrefix)
        {
            channelName = this.channelPrefix + channelName;
        }
        return channelName;
    }

    private _cancelPendingSubscribeCallback(channel: TGChannel<any>)
    {
        if (channel._pendingSubscriptionCid != null)
        {
            this.transport.cancelPendingResponse(
                channel._pendingSubscriptionCid
            );
            delete channel._pendingSubscriptionCid;
        }
    }

    private _triggerChannelSubscribeFail(
        err: Error,
        channel: TGChannel<any>,
        subscriptionOptions: SubscribeOptions
    ): void
    {
        const channelName           = channel.name;
        const meetsAuthRequirements =
                  !channel.options['waitForAuth'] ||
                  this.authState === TGClientSocket.AUTHENTICATED;
        const hasChannel            = !!this._channelMap[channelName];

        if (hasChannel && meetsAuthRequirements)
        {
            delete this._channelMap[channelName];

            this._channelEventDemux.write(`${channelName}/subscribeFail`, {
                error: err,
                subscriptionOptions,
            });
            this.emit('subscribeFail', {
                error              : err,
                channel            : channelName,
                subscriptionOptions: subscriptionOptions,
            } as SubscribeFailData);
        }
    }

    private _triggerChannelSubscribe(
        channel: TGChannel<any>,
        subscriptionOptions: SubscribeOptions
    ): void
    {
        const channelName = channel.name;

        if (channel.state !== TGChannel.SUBSCRIBED)
        {
            const oldChannelState = channel.state;
            channel.state         = TGChannel.SUBSCRIBED;

            const stateChangeData = {
                oldChannelState,
                newChannelState: channel.state,
                subscriptionOptions,
            };
            this._channelEventDemux.write(
                `${channelName}/subscribeStateChange`,
                stateChangeData
            );
            this._channelEventDemux.write(`${channelName}/subscribe`, {
                subscriptionOptions,
            });
            this.emit('subscribeStateChange', {
                channel: channelName,
                ...stateChangeData,
            });
            this.emit('subscribe', {
                channel: channelName,
                subscriptionOptions,
            });
        }
    }

    private _processOutboundEvent(
        event: string,
        data: any,
        options?: {ackTimeout?: number|undefined},
        expectResponse?: boolean
    ): Promise<any>
    {
        options = options || {};

        if (this.state === TGClientSocket.CLOSED)
        {
            this.connect();
        }
        const eventObject: EventObject = {
            event,
            data: null,
        };

        let promise: Promise<any>;

        if (expectResponse)
        {
            promise = new Promise((resolve, reject) =>
            {
                eventObject.callback = (err, data) =>
                {
                    if (err)
                    {
                        reject(err);
                        return;
                    }
                    resolve(data);
                };
            });
        }
        else
        {
            promise = Promise.resolve();
        }

        const eventNode: any = new Item();

        if (this.options.cloneData)
        {
            eventObject.data = cloneDeep(data);
        }
        else
        {
            eventObject.data = data;
        }
        eventNode.data = eventObject;

        const ackTimeout =
                  options.ackTimeout == null ? this.ackTimeout : options.ackTimeout;

        eventObject.timeout = setTimeout(() =>
        {
            this._handleEventAckTimeout(eventObject, eventNode);
        }, ackTimeout);

        this._outboundBuffer.append(eventNode);
        if (this.state === TGClientSocket.OPEN)
        {
            this._flushOutboundBuffer();
        }
        return promise;
    }

    private _handleEventAckTimeout(
        eventObject: EventObject,
        eventNode: any
    ): void
    {
        if (eventNode)
        {
            eventNode.detach();
        }
        delete eventObject.timeout;

        const callback = eventObject.callback;
        if (callback)
        {
            delete eventObject.callback;
            const error = new TimeoutError(
                `Event response for "${eventObject.event}" timed out`
            );
            callback.call(eventObject, error, eventObject);
        }
        // Cleanup any pending response callback in the transport layer too.
        if (eventObject.cid)
        {
            this.transport.cancelPendingResponse(eventObject.cid);
        }
    }

    private _flushOutboundBuffer(): void
    {
        let currentNode = this._outboundBuffer.head;
        let nextNode;

        while (currentNode)
        {
            nextNode          = currentNode.next;
            const eventObject = currentNode.data;
            currentNode.detach();
            this.transport.transmitObject(eventObject);
            currentNode = nextNode;
        }
    }

    private _onInboundInvoke(request: TGRequest): void
    {
        const { procedure, data } = request;
        const handler             = this._privateRPCHandlerMap[procedure];
        if (handler)
        {
            handler.call(this, data, request);
        }
        else
        {
            this._procedureDemux.write(procedure, request);
        }
    }

    private _onInboundTransmit(event: string, data: any): void
    {
        const handler = this._privateDataHandlerMap[event];
        if (handler)
        {
            handler.call(this, data);
        }
        else
        {
            this._receiverDemux.write(event, data);
        }
    }

    private _destroy(code: number, reason?: string, openAbort?: boolean): void
    {
        this.id = null;
        this._cancelBatching();

        if (this.transport)
        {
            this.transport.clearAllListeners();
        }

        this.pendingReconnect        = false;
        this.pendingReconnectTimeout = null;
        clearTimeout(this._reconnectTimeoutRef);

        this._suspendSubscriptions();

        if (openAbort)
        {
            this.emit('connectAbort', { code, reason });
        }
        else
        {
            this.emit('disconnect', { code, reason });
        }
        this.emit('close', { code, reason });

        if (
            !TGClientSocket.ignoreStatuses[
                code as keyof SocketProtocolIgnoreStatuses
                ]
        )
        {
            let closeMessage;
            if (reason)
            {
                closeMessage =
                    'Socket connection closed with status code ' +
                    code +
                    ' and reason: ' +
                    reason;
            }
            else
            {
                closeMessage =
                    'Socket connection closed with status code ' + code;
            }
            const err = new SocketProtocolError(
                TGClientSocket.errorStatuses[
                    code as keyof SocketProtocolErrorStatuses
                    ] || closeMessage,
                code
            );
            this._onError(err);
        }

        this._abortAllPendingEventsDueToBadConnection(
            openAbort ? 'connectAbort' : 'disconnect'
        );

        // Try to reconnect
        // on server ping timeout (4000)
        // or on client pong timeout (4001)
        // or on close without status (1005)
        // or on handshake failure (4003)
        // or on handshake rejection (4008)
        // or on socket hung up (1006)
        if (this.options.autoReconnect)
        {
            if (code === 4000 || code === 4001 || code === 1005)
            {
                // If there is a ping or pong timeout or socket closes without
                // status, don't wait before trying to reconnect - These could happen
                // if the client wakes up after a period of inactivity and in this case we
                // want to re-establish the connection as soon as possible.
                this._tryReconnect(0);

                // Codes 4500 and above will be treated as permanent disconnects.
                // Socket will not try to auto-reconnect.
            }
            else if (code !== 1000 && code < 4500)
            {
                this._tryReconnect();
            }
        }
    }

    private _abortAllPendingEventsDueToBadConnection(
        failureType: string
    ): void
    {
        let currentNode = this._outboundBuffer.head;
        let nextNode;

        while (currentNode)
        {
            nextNode          = currentNode.next;
            const eventObject = currentNode.data;
            clearTimeout(eventObject.timeout);
            delete eventObject.timeout;
            currentNode.detach();
            currentNode = nextNode;

            const callback = eventObject.callback;

            if (callback)
            {
                delete eventObject.callback;
                const errorMessage = `Event "${eventObject.event}" was aborted due to a bad connection`;
                const error        = new BadConnectionError(errorMessage, failureType);

                callback.call(eventObject, error, eventObject);
            }
            // Cleanup any pending response callback in the transport layer too.
            if (eventObject.cid)
            {
                this.transport.cancelPendingResponse(eventObject.cid);
            }
        }
    }

    private _suspendSubscriptions(): void
    {
        Object.keys(this._channelMap).forEach((channelName) =>
        {
            const channel = this._channelMap[channelName];
            this._triggerChannelUnsubscribe(channel, true);
        });
    }

    private _onError(error: any): void
    {
        this.emit('error', { error });
    }

    private _tryReconnect(initialDelay?: number): void
    {
        const exponent         = this.connectAttempts++;
        const reconnectOptions = this.options.autoReconnectOptions;
        let timeout;

        if (initialDelay == null || exponent > 0)
        {
            const initialTimeout = Math.round(
                reconnectOptions.initialDelay +
                (reconnectOptions.randomness || 0) * Math.random()
            );

            timeout = Math.round(
                initialTimeout * Math.pow(reconnectOptions.multiplier, exponent)
            );
        }
        else
        {
            timeout = initialDelay;
        }

        if (timeout > reconnectOptions.maxDelay)
        {
            timeout = reconnectOptions.maxDelay;
        }

        clearTimeout(this._reconnectTimeoutRef);

        this.pendingReconnect        = true;
        this.pendingReconnectTimeout = timeout;
        this._reconnectTimeoutRef    = setTimeout(() =>
        {
            this.connect();
        }, timeout);
    }

    private _onOpen(status: any): void
    {
        if (this.isBatching)
        {
            this._startBatching();
        }
        else if (this.batchOnHandshake)
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
        this.preparingPendingSubscriptions = true;

        if (status)
        {
            this.id          = status.id;
            this.pingTimeout = status.pingTimeout;
            if (status.isAuthenticated)
            {
                this._changeToAuthenticatedState(status.authToken);
            }
            else
            {
                this._changeToUnauthenticatedStateAndClearTokens();
            }
        }
        else
        {
            // This can happen if auth.loadToken (in transport.js) fails with
            // an error - This means that the signedAuthToken cannot be loaded by
            // the auth engine and therefore, we need to unauthenticate the client.
            this._changeToUnauthenticatedStateAndClearTokens();
        }

        this.connectAttempts = 0;

        if (this.options.autoSubscribeOnConnect)
        {
            this.processPendingSubscriptions();
        }

        // If the user invokes the callback while in autoSubscribeOnConnect mode, it
        // won't break anything.
        this.emit('connect', {
            ...status,
            processPendingSubscriptions: () =>
            {
                this.processPendingSubscriptions();
            },
        });

        if (this.state === TGClientSocket.OPEN)
        {
            this._flushOutboundBuffer();
        }
    }

    private _extractAuthTokenData(signedAuthToken: string): any
    {
        const tokenParts       = (signedAuthToken || '').split('.');
        const encodedTokenData = tokenParts[1];
        if (encodedTokenData != null)
        {
            let tokenData = encodedTokenData;
            try
            {
                tokenData = this.decodeBase64(tokenData);
                return JSON.parse(tokenData);
            }
            catch (e)
            {
                return tokenData;
            }
        }
        return null;
    }

    private _changeToAuthenticatedState(
        signedAuthToken: SignedAuthToken
    ): void
    {
        this.signedAuthToken = signedAuthToken;
        this.authToken       = this._extractAuthTokenData(signedAuthToken);

        if (this.authState !== TGClientSocket.AUTHENTICATED)
        {
            const oldAuthState    = this.authState;
            this.authState        = TGClientSocket.AUTHENTICATED;
            const stateChangeData = {
                oldAuthState,
                newAuthState   : this.authState,
                signedAuthToken: signedAuthToken,
                authToken      : this.authToken,
            };
            if (!this.preparingPendingSubscriptions)
            {
                this.processPendingSubscriptions();
            }

            this.emit('authStateChange', stateChangeData);
        }
        this.emit('authenticate', {
            signedAuthToken,
            authToken: this.authToken,
        });
    }

    private _changeToUnauthenticatedStateAndClearTokens(): void
    {
        if (this.authState !== TGClientSocket.UNAUTHENTICATED)
        {
            const oldAuthState       = this.authState;
            const oldAuthToken       = this.authToken;
            const oldSignedAuthToken = this.signedAuthToken;
            this.authState           = TGClientSocket.UNAUTHENTICATED;
            this.signedAuthToken     = null;
            this.authToken           = null;

            const stateChangeData = {
                oldAuthState,
                newAuthState: this.authState,
            };
            this.emit('authStateChange', stateChangeData);
            this.emit('deauthenticate', { oldSignedAuthToken, oldAuthToken });
        }
    }

    private async _handleBrowserUnload(): Promise<void>
    {
        const unloadHandler         = () =>
        {
            this.disconnect();
        };
        let isUnloadHandlerAttached = false;

        const attachUnloadHandler = () =>
        {
            if (!isUnloadHandlerAttached)
            {
                isUnloadHandlerAttached = true;
                global.addEventListener('beforeunload', unloadHandler, false);
            }
        };

        const detachUnloadHandler = () =>
        {
            if (isUnloadHandlerAttached)
            {
                isUnloadHandlerAttached = false;
                global.removeEventListener(
                    'beforeunload',
                    unloadHandler,
                    false
                );
            }
        };

        (async () =>
        {
            const consumer = this.listener('connecting').createConsumer();
            while (true)
            {
                const packet = await consumer.next();
                if (packet.done) break;
                attachUnloadHandler();
            }
        })();

        (async () =>
        {
            const consumer = this.listener('close').createConsumer();
            while (true)
            {
                const packet = await consumer.next();
                if (packet.done) break;
                detachUnloadHandler();
            }
        })();
    }

    private _setAuthToken(data: any)
    {
        this._changeToAuthenticatedState(data.token);

        (async () =>
        {
            try
            {
                await this.auth.saveToken(this.authTokenName, data.token, {});
            }
            catch (err)
            {
                this._onError(err);
            }
        })();
    }

    private _removeAuthToken(): void
    {
        (async () =>
        {
            let oldAuthToken;
            try
            {
                oldAuthToken = await this.auth.removeToken(this.authTokenName);
            }
            catch (err)
            {
                // Non-fatal error - Do not close the connection
                this._onError(err);
                return;
            }
            this.emit('removeAuthToken', { oldAuthToken });
        })();

        this._changeToUnauthenticatedStateAndClearTokens();
    }
}
