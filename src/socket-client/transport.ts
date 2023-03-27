import { CodecEngine } from '../socket-server/types';
import {
    AGAuthEngine,
    CallIdGenerator,
    ClientOptions, EventObject, EventObjectCallback, InvokeOptions,
    OnCloseValue,
    OnErrorValue,
    OnEventValue,
    OnInboundInvokeValue,
    OnInboundTransmitValue,
    OnOpenAbortValue,
    OnOpenValue,
    ProtocolVersions,
    States, TransmitOptions,
    TransportHandlers
} from './types';
import { BadConnectionError, hydrateError, socketProtocolErrorStatuses, TimeoutError } from '../sc-errors/errors';
import { AGRequest } from '../ag-request';

export class AGTransport
{
    static CONNECTING: States = 'connecting';
    static OPEN: States       = 'open';
    static CLOSED: States     = 'closed';

    state: States;
    auth: AGAuthEngine;
    codec: CodecEngine;
    options: ClientOptions;
    wsOptions?: ClientOptions|undefined;
    protocolVersion: ProtocolVersions;
    connectTimeout: number;
    pingTimeout: number;
    pingTimeoutDisabled: boolean;
    callIdGenerator: CallIdGenerator;
    authTokenName: string;
    isBufferingBatch: boolean;
    socket: WebSocket;
    private _pingTimeoutTicker: any;
    private _callbackMap: {[key: string]: any};
    private _batchBuffer: any[];
    private _onOpenHandler: (value?: OnOpenValue) => void;
    private _onOpenAbortHandler: (value: OnOpenAbortValue) => void;
    private _onCloseHandler: (value: OnCloseValue) => void;
    private _onEventHandler: (value: OnEventValue) => void;
    private _onErrorHandler: (value: OnErrorValue) => void;
    private _onInboundInvokeHandler: (value: OnInboundInvokeValue) => void;
    private _onInboundTransmitHandler: (value: OnInboundTransmitValue) => void;
    private _connectTimeoutRef: number;
    private _handlePing: (message) => (boolean);

    /**
     * Constructor
     */
    constructor(
        authEngine: AGAuthEngine,
        codecEngine: CodecEngine,
        options: ClientOptions,
        wsOptions?: ClientOptions,
        handlers?: TransportHandlers,
    )
    {
        this.state               = AGTransport.CLOSED;
        this.auth                = authEngine;
        this.codec               = codecEngine;
        this.options             = options;
        this.wsOptions           = wsOptions;
        this.protocolVersion     = options.protocolVersion;
        this.connectTimeout      = options.connectTimeout;
        this.pingTimeout         = options.pingTimeout;
        this.pingTimeoutDisabled = !!options.pingTimeoutDisabled;
        this.callIdGenerator     = options.callIdGenerator;
        this.authTokenName       = options.authTokenName;
        this.isBufferingBatch    = false;

        this._pingTimeoutTicker = null;
        this._callbackMap       = {};
        this._batchBuffer       = [];

        if (!handlers)
        {
            handlers = {};
        }

        this._onOpenHandler            = handlers.onOpen || function ()
        {
        };
        this._onOpenAbortHandler       = handlers.onOpenAbort || function ()
        {
        };
        this._onCloseHandler           = handlers.onClose || function ()
        {
        };
        this._onEventHandler           = handlers.onEvent || function ()
        {
        };
        this._onErrorHandler           = handlers.onError || function ()
        {
        };
        this._onInboundInvokeHandler   = handlers.onInboundInvoke || function ()
        {
        };
        this._onInboundTransmitHandler = handlers.onInboundTransmit || function ()
        {
        };

        // Open the connection.

        this.state = AGTransport.CONNECTING;
        let uri    = this.uri();

        let wsSocket        = createWebSocket(uri, wsOptions);
        wsSocket.binaryType = this.options.binaryType;

        this.socket = wsSocket;

        wsSocket.onopen = () =>
        {
            this._onOpen();
        };

        wsSocket.onclose = async (event) =>
        {
            let code;
            if (event.code == null)
            {
                // This is to handle an edge case in React Native whereby
                // event.code is undefined when the mobile device is locked.
                // TODO: This is not ideal since this condition could also apply to
                // an abnormal close (no close control frame) which would be a 1006.
                code = 1005;
            }
            else
            {
                code = event.code;
            }
            this._destroy(code, event.reason);
        };

        wsSocket.onmessage = (message, flags) =>
        {
            this._onMessage(message.data);
        };

        wsSocket.onerror = (error) =>
        {
            // The onclose event will be called automatically after the onerror event
            // if the socket is connected - Otherwise, if it's in the middle of
            // connecting, we want to close it manually with a 1006 - This is necessary
            // to prevent inconsistent behavior when running the client in Node.js
            // vs in a browser.
            if (this.state === AGTransport.CONNECTING)
            {
                this._destroy(1006);
            }
        };

        this._connectTimeoutRef = setTimeout(() =>
        {
            this._destroy(4007);
            this.socket.close(4007);
        }, this.connectTimeout);

        if (this.protocolVersion === 1)
        {
            this._handlePing = (message) =>
            {
                if (message === '#1')
                {
                    this._resetPingTimeout();
                    if (this.socket.readyState === this.socket.OPEN)
                    {
                        this.send('#2');
                    }
                    return true;
                }
                return false;
            };
        }
        else
        {
            this._handlePing = (message) =>
            {
                if (message === '')
                {
                    this._resetPingTimeout();
                    if (this.socket.readyState === this.socket.OPEN)
                    {
                        this.send('');
                    }
                    return true;
                }
                return false;
            };
        }
    }

    // -----------------------------------------------------------------------------------------------------
    // @ Public methods
    // -----------------------------------------------------------------------------------------------------

    uri(): string
    {
        let query = this.options.query || {};
        let scheme;
        if (this.options.protocolScheme == null)
        {
            scheme = this.options.secure ? 'wss' : 'ws';
        }
        else
        {
            scheme = this.options.protocolScheme;
        }

        if (this.options.timestampRequests)
        {
            query[this.options.timestampParam] = (new Date()).getTime();
        }

        let searchParams = new URLSearchParams();
        for (let [key, value] of Object.entries(query))
        {
            if (Array.isArray(value))
            {
                for (let item of value)
                {
                    searchParams.append(key, item);
                }
            }
            else
            {
                searchParams.set(key, value);
            }
        }

        query = searchParams.toString();

        if (query.length)
        {
            query = '?' + query;
        }

        let host;
        let path;
        if (this.options.socketPath == null)
        {
            if (this.options.host)
            {
                host = this.options.host;
            }
            else
            {
                let port = '';

                if (this.options.port && ((scheme === 'wss' && this.options.port !== 443)
                    || (scheme === 'ws' && this.options.port !== 80)))
                {
                    port = ':' + this.options.port;
                }
                host = this.options.hostname + port;
            }
            path = this.options.path;
        }
        else
        {
            host = this.options.socketPath;
            path = `:${this.options.path}`;
        }
        return scheme + '://' + host + path + query;
    }

    clearAllListeners(): void
    {
        this._onOpenHandler            = function ()
        {
        };
        this._onOpenAbortHandler       = function ()
        {
        };
        this._onCloseHandler           = function ()
        {
        };
        this._onEventHandler           = function ()
        {
        };
        this._onErrorHandler           = function ()
        {
        };
        this._onInboundInvokeHandler   = function ()
        {
        };
        this._onInboundTransmitHandler = function ()
        {
        };
    }

    startBatch(): void
    {
        this.isBufferingBatch = true;
        this._batchBuffer     = [];
    }

    flushBatch(): void
    {
        this.isBufferingBatch = false;
        if (!this._batchBuffer.length)
        {
            return;
        }
        let serializedBatch = this.serializeObject(this._batchBuffer);
        this._batchBuffer   = [];
        this.send(serializedBatch);
    }

    cancelBatch(): void
    {
        this.isBufferingBatch = false;
        this._batchBuffer     = [];
    }

    getBytesReceived(): any
    {
        return this.socket['bytesReceived'];
    }

    close(code?: number, reason?: string): void
    {
        if (this.state === AGTransport.OPEN || this.state === AGTransport.CONNECTING)
        {
            code = code || 1000;
            this._destroy(code, reason);
            this.socket.close(code, reason);
        }
    }

    transmitObject(eventObject: EventObject): number|null
    {
        let simpleEventObject: EventObject = {
            event: eventObject.event,
            data : eventObject.data
        };

        if (eventObject.callback)
        {
            simpleEventObject.cid              = eventObject.cid = this.callIdGenerator();
            this._callbackMap[eventObject.cid] = eventObject;
        }

        this.sendObject(simpleEventObject);

        return eventObject.cid || null;
    }

    transmit(event: string, data: any, options: TransmitOptions): Promise<void>
    {
        let eventObject = {
            event,
            data
        };

        if (this.state === AGTransport.OPEN || options.force)
        {
            this.transmitObject(eventObject);
        }
        return Promise.resolve();
    }

    invokeRaw(
        event: string,
        data: any,
        options: InvokeOptions,
        callback?: EventObjectCallback,
    ): number|null
    {
        let eventObject: EventObject = {
            event,
            data,
            callback
        };

        if (!options.noTimeout)
        {
            eventObject.timeout = setTimeout(() =>
            {
                this._handleEventAckTimeout(eventObject);
            }, this.options.ackTimeout);
        }
        let cid = null;
        if (this.state === AGTransport.OPEN || options.force)
        {
            cid = this.transmitObject(eventObject);
        }
        return cid;
    }

    invoke<T extends EventObject>(event: string, data: T, options: InvokeOptions): Promise<T>
    {
        return new Promise((resolve, reject) =>
        {
            this.invokeRaw(event, data, options, (err, data) =>
            {
                if (err)
                {
                    reject(err);
                    return;
                }
                resolve(data as T);
            });
        });
    }

    cancelPendingResponse(cid: number): void
    {
        delete this._callbackMap[cid];
    }

    decode(message: any): any
    {
        return this.codec.decode(message);
    }

    encode(object: any): any
    {
        return this.codec.encode(object);
    }

    send(data: any): void
    {
        if (this.socket.readyState !== this.socket.OPEN)
        {
            this._destroy(1005);
        }
        else
        {
            this.socket.send(data);
        }
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
            this._onError(error);
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
        let str = this.serializeObject(object);
        if (str != null)
        {
            this.send(str);
        }
    }

    // -----------------------------------------------------------------------------------------------------
    // @ Private methods
    // -----------------------------------------------------------------------------------------------------

    private _handleEventAckTimeout(eventObject: EventObject): void
    {
        if (eventObject.cid)
        {
            delete this._callbackMap[eventObject.cid];
        }
        delete eventObject.timeout;

        let callback = eventObject.callback;
        if (callback)
        {
            delete eventObject.callback;
            let error = new TimeoutError(`Event response for "${eventObject.event}" timed out`);
            callback.call(eventObject, error, eventObject);
        }
    }

    private async _onOpen(): Promise<void>
    {
        clearTimeout(this._connectTimeoutRef);
        this._resetPingTimeout();

        let status;

        try
        {
            status = await this._handshake();
        }
        catch (err)
        {
            if (err.statusCode == null)
            {
                err.statusCode = 4003;
            }
            this._onError(err);
            this._destroy(err.statusCode, err.toString());
            this.socket.close(err.statusCode);
            return;
        }

        this.state = AGTransport.OPEN;
        if (status)
        {
            this.pingTimeout = status.pingTimeout;
        }
        this._resetPingTimeout();
        this._onOpenHandler(status);
    }

    private async _handshake()
    {
        let token = await this.auth.loadToken(this.authTokenName);
        // Don't wait for this.state to be 'open'.
        // The underlying WebSocket (this.socket) is already open.
        let options = {
            force: true
        };
        let status  = await this.invoke('#handshake', { authToken: token }, options);
        if (status)
        {
            // Add the token which was used as part of authentication attempt
            // to the status object.
            status.authToken = token;
            if (status.authError)
            {
                status.authError = hydrateError(status.authError);
            }
        }
        return status;
    }

    private _abortAllPendingEventsDueToBadConnection(failureType): void
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
            if (callback)
            {
                delete eventObject.callback;

                callback.call(eventObject, badConnectionError, eventObject);
            }
        });
    }

    private _destroy(code?: number, reason?: any): void
    {
        let protocolReason = socketProtocolErrorStatuses[code];
        if (!reason && socketProtocolErrorStatuses[code])
        {
            reason = socketProtocolErrorStatuses[code];
        }
        delete this.socket.onopen;
        delete this.socket.onclose;
        delete this.socket.onmessage;
        delete this.socket.onerror;

        clearTimeout(this._connectTimeoutRef);
        clearTimeout(this._pingTimeoutTicker);

        if (this.state === AGTransport.OPEN)
        {
            this.state = AGTransport.CLOSED;
            this._abortAllPendingEventsDueToBadConnection('disconnect');
            this._onCloseHandler({ code, reason });
        }
        else if (this.state === AGTransport.CONNECTING)
        {
            this.state = AGTransport.CLOSED;
            this._abortAllPendingEventsDueToBadConnection('connectAbort');
            this._onOpenAbortHandler({ code, reason });
        }
        else if (this.state === AGTransport.CLOSED)
        {
            this._abortAllPendingEventsDueToBadConnection('connectAbort');
        }
    }

    private _processInboundPacket(packet, message): void
    {
        if (packet && packet.event != null)
        {
            if (packet.cid == null)
            {
                this._onInboundTransmitHandler({ ...packet });
            }
            else
            {
                let request = new AGRequest(this, packet.cid, packet.event, packet.data);
                this._onInboundInvokeHandler(request);
            }
        }
        else if (packet && packet.rid != null)
        {
            let eventObject = this._callbackMap[packet.rid];
            if (eventObject)
            {
                clearTimeout(eventObject.timeout);
                delete eventObject.timeout;
                delete this._callbackMap[packet.rid];

                if (eventObject.callback)
                {
                    let rehydratedError = hydrateError(packet.error);
                    eventObject.callback(rehydratedError, packet.data);
                }
            }
        }
        else
        {
            this._onEventHandler({ event: 'raw', data: { message } });
        }
    }

    private _onMessage(message): void
    {
        this._onEventHandler({ event: 'message', data: { message } });

        if (this._handlePing(message))
        {
            return;
        }

        let packet = this.decode(message);

        if (Array.isArray(packet))
        {
            let len = packet.length;
            for (let i = 0; i < len; i++)
            {
                this._processInboundPacket(packet[i], message);
            }
        }
        else
        {
            this._processInboundPacket(packet, message);
        }
    }

    private _onError(error): void
    {
        this._onErrorHandler({ error });
    }

    private _resetPingTimeout(): void
    {
        if (this.pingTimeoutDisabled)
        {
            return;
        }

        let now = (new Date()).getTime();
        clearTimeout(this._pingTimeoutTicker);
        this._pingTimeoutTicker = setTimeout(() =>
        {
            this._destroy(4000);
            this.socket.close(4000);
        }, this.pingTimeout);
    }
}
