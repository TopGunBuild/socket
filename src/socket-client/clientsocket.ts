import { AGChannelClient } from '../ag-channel/client';
import { AsyncStreamEmitter } from '../async-stream-emitter';
import { SocketProtocolErrorStatuses, SocketProtocolIgnoreStatuses } from '../sc-errors/types';
import { AGAuthEngine, AuthStates, AuthToken, ClientOptions, ProtocolVersions, SignedAuthToken, States } from './types';
import { AGTransport } from './transport';
import { CodecEngine } from '../socket-server/types';
import { InvalidArgumentsError } from '../sc-errors/errors';
import { StreamDemux } from '../stream-demux';

const isBrowser = typeof window !== 'undefined';

export class AGClientSocket extends AsyncStreamEmitter<any> implements AGChannelClient
{
    static readonly CONNECTING: States = 'connecting';
    static readonly OPEN: States       = 'open';
    static readonly CLOSED: States     = 'closed';

    static readonly AUTHENTICATED: AuthStates   = 'authenticated';
    static readonly UNAUTHENTICATED: AuthStates = 'unauthenticated';

    static readonly SUBSCRIBED   = 'subscribed';
    static readonly PENDING      = 'pending';
    static readonly UNSUBSCRIBED = 'unsubscribed';

    static readonly ignoreStatuses: SocketProtocolIgnoreStatuses;
    static readonly errorStatuses: SocketProtocolErrorStatuses;

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

    isBufferingBatch: boolean;
    isBatching: boolean;
    batchOnHandshake: boolean;
    batchOnHandshakeDuration: number;

    auth: AGAuthEngine;
    codec: CodecEngine;
    transport?: AGTransport|undefined;

    poolIndex?: number|undefined;
    private _batchingIntervalId: any;

    /**
     * Constructor
     */
    constructor(socketOptions: ClientOptions)
    {
        super();

        let defaultOptions: ClientOptions = {
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
            cloneData               : false
        };
        const opts: ClientOptions         = Object.assign(defaultOptions, socketOptions);

        this.id                            = null;
        this.version                       = opts.version || null;
        this.protocolVersion               = opts.protocolVersion;
        this.state                         = AGClientSocket.CLOSED;
        this.authState                     = AGClientSocket.UNAUTHENTICATED;
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
        this.disconnectOnUnload = opts.disconnectOnUnload == null ? true : opts.disconnectOnUnload;
        this.authTokenName      = opts.authTokenName;

        // pingTimeout will be connectTimeout at the start, but it will
        // be updated with values provided by the 'connect' event
        opts.pingTimeout         = opts.connectTimeout;
        this.pingTimeout         = opts.pingTimeout;
        this.pingTimeoutDisabled = !!opts.pingTimeoutDisabled;

        let maxTimeout = Math.pow(2, 31) - 1;

        let verifyDuration = (propertyName) =>
        {
            if (this[propertyName] > maxTimeout)
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
            let reconnectOptions = this.options.autoReconnectOptions;
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

        if (this.options.protocol)
        {
            let protocolOptionError = new InvalidArgumentsError(
                'The "protocol" option does not affect socketcluster-client - ' +
                'If you want to utilize SSL/TLS, use "secure" option instead'
            );
            this._onError(protocolOptionError);
        }

        this.options.query = opts.query || {};
        if (typeof this.options.query === 'string')
        {
            let searchParams = new URLSearchParams(this.options.query);
            let queryObject  = {};
            for (let [key, value] of searchParams.entries())
            {
                let currentValue = queryObject[key];
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
            }
            this.options.query = queryObject;
        }

        if (isBrowser && this.disconnectOnUnload && global.addEventListener && global.removeEventListener)
        {
            this._handleBrowserUnload();
        }

        if (this.options.autoConnect)
        {
            this.connect();
        }
    }
}
