import { ChannelState, TGChannelOptions } from '../channel/types';
import { TGChannel } from '../channel/channel';
import { AuthEngine } from './auth';
import { AuthState, AuthToken, CodecEngine } from '../types';

export interface IClientSocket
{
    subscribe?(channelName: string, options?: any): TGChannel<any>;

    unsubscribe?(channelName: string): void;

    isSubscribed?(channelName: string, includePending?: boolean): boolean;

    publish?(channelName: string, data: any, callback?: (err?: Error) => void): void;

    destroyChannel?(channelName: string): void;

    getChannelState?(channelName: string): ChannelState;

    getChannelOptions?(channelName: string): TGChannelOptions;

    closeChannel?(channelName: string): void;
}

export interface AutoReconnectOptions
{
    initialDelay?: number|undefined;
    randomness?: number|undefined;
    multiplier?: number|undefined;
    maxDelay?: number|undefined;
}

export interface TGSocketClientOptions
{
    // (milliseconds) - This is the timeout for getting a response to a AGClientSocket invoke action.
    ackTimeout?: number|undefined;

    // (milliseconds)
    connectTimeout?: number|undefined;

    // Whether or not to automatically connect the socket as soon as it is created. Default is true.
    autoConnect?: boolean|undefined;

    // Whether or not to automatically reconnect the socket when it loses the connection. Default is true.
    autoReconnect?: boolean|undefined;

    // Valid properties are: initialDelay (milliseconds), randomness (milliseconds), multiplier (decimal; default is 1.5) and maxDelay (milliseconds).
    autoReconnectOptions?: AutoReconnectOptions|undefined;

    // This is true by default. If you set this to false, then the socket will not automatically try to subscribe to pending subscriptions on
    // connect - Instead, you will have to manually invoke the processSubscriptions callback from inside the 'connect' event handler on the client side.
    // See AGClientSocket API. This gives you more fine-grained control with regards to when pending subscriptions are processed after the socket
    // connection is established (or re-established).
    autoSubscribeOnConnect?: boolean|undefined;

    version?: string|undefined;

    // If you set this to true, any data/objects/arrays that you pass to the client socket will be cloned before being sent/queued up. If the socket
    // is disconnected and you emit an event, it will be added to a queue which will be processed upon reconnection. The cloneData option is false
    // by default; this means that if you emit/publish an object and that object changes somewhere else in your code before the queue is processed,
    // then the changed version of that object will be sent out to the server.
    cloneData?: boolean|undefined;

    // A prefix to add to the channel names.
    channelPrefix?: string|null|undefined;

    // Whether or not a client automatically disconnects on page unload. If enabled, the client will disconnect when a user navigates away from the page.
    // This can happen when a user closes the tab/window, clicks a link to leave the page, or types a new URL into the address bar. Defaults to true.
    disconnectOnUnload?: boolean|undefined;

    // Lets you set a custom codec engine. This allows you to specify how data gets encoded before being sent over the wire and how it gets decoded
    // once it reaches the other side. The codecEngine must be an object which exposes an encode(object) and a decode(encodedData) function.
    // The encode function can return any data type - Commonly a string or a Buffer/ArrayBuffer. The decode function needs to return a JavaScript
    // object which adheres to the SC protocol. The idea of using a custom codec is that it allows you to compress TopGunSocket packets in any format
    // you like (optimized for any use case) - By decoding these packets back into their original protocol form, TopGunSocket will be able process
    // them appropriately. Note that if you provide a codecEngine when creating a client socket, you will need to make sure that the server uses the
    // same codec by passing the same engine to the AGServer constructor (using the codecEngine option).
    codecEngine?: CodecEngine|null|undefined;

    clientId?: string;

    socketPath?: string|undefined|null;

    host?: string|undefined;

    // Defaults to the current host (read from the URL).
    hostname?: string|undefined;

    // Defaults to false.
    secure?: boolean|undefined;

    // Defaults to 80 if !secure otherwise defaults to 443.
    port?: number|undefined;

    // The URL which TopGunSocket uses to make the initial handshake for the WebSocket. Defaults to '/topgunsocket/'.
    path?: string|undefined;

    // The type to use to represent binary on the client. Defaults to 'arraybuffer'.
    binaryType?: string|undefined|BinaryType;

    // pingTimeout will be connectTimeout at the start, but it will be updated with values provided by the 'connect' event.
    pingTimeout?: number|undefined;

    pingTimeoutDisabled?: boolean|undefined;

    callIdGenerator?: CallIdGenerator|undefined;

    // The name of the JWT auth token (provided to the authEngine - By default this is the localStorage variable name); defaults to 'topgunsocket.authToken'.
    authTokenName?: string|undefined;

    // A map of key-value pairs which will be used as query parameters for the initial HTTP handshake which will initiate the WebSocket connection.
    query?: string|{[key: string]: string|number|boolean}|undefined;

    // Whether or not to add a timestamp to the WebSocket handshake request.
    timestampRequests?: boolean|undefined;

    // The query parameter name to use to hold the timestamp.
    timestampParam?: string|undefined;

    pubSubBatchDuration?: number|undefined;

    subscriptionRetryOptions?: object|null|undefined;

    // A custom engine to use for storing and loading JWT auth tokens on the client side.
    authEngine?: AuthEngine|null|undefined;

    protocol?: string|undefined|null;
}

export type ProtocolVersions = 1|2;
export type CallIdGenerator = () => number;
export type WatcherFunction = (data: any) => void;

export interface TGAuthEngine
{
    saveToken(
        name: string,
        token: AuthToken|string,
        options?: {[key: string]: any}
    ): Promise<AuthToken|string>;

    removeToken(name: string): Promise<AuthToken|string|null>;

    loadToken(name: string): Promise<AuthToken|string|null>;
}

export interface TransmitOptions
{
    force?: boolean|undefined;
    noTimeout?: boolean|undefined;
    ackTimeout?: number|undefined;
    batch?: boolean;
}

export interface InvokeOptions
{
    force?: boolean|undefined;
    noTimeout?: boolean|undefined;
    ackTimeout?: number|undefined;
}

export interface AuthStatus
{
    isAuthenticated: AuthState;
    authError: Error;
}

export interface SubscribeOptions
{
    waitForAuth?: boolean|undefined;
    priority?: number|undefined;
    data?: any;
    batch?: boolean;
}