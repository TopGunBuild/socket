import { JwtSecret } from 'topgun-jsonwebtoken';
import { AuthEngineType, CodecEngine } from '../types';

export interface TGSocketServerOptions {
    // An instance of a Node.js HTTP server.
    // https://nodejs.org/api/http.html#http_class_http_server
    // This option should not be set if the server is created
    // with socketClusterServer.attach(...).
    httpServer?: any;

    // This can be the name of an npm module or a path to a
    // Node.js module to use as the WebSocket server engine.
    wsEngine?: string | { Server: any };

    // Custom options to pass to the wsEngine when it is being
    // instantiated.
    wsEngineServerOptions?: any;

    // The key which SC will use to encrypt/decrypt authTokens,
    // defaults to a 256 bits cryptographically random hex
    // string. The default JWT algorithm used is 'HS256'.
    // If you want to use RSA or ECDSA, you should provide an
    // authPrivateKey and authPublicKey instead of authKey.
    authKey?: JwtSecret;

    // perMessageDeflate compression. Note that this option is
    // passed directly to the wsEngine's Server object.
    // So if you're using 'ws' as the engine, you can pass an
    // object instead of a boolean.
    // Note that by default, per-message deflate only kicks in
    // for messages > 1024 bytes.
    perMessageDeflate?: boolean | {};

    // If using an RSA or ECDSA algorithm to sign the
    // authToken, you will need to provide an authPrivateKey
    // and authPublicKey in PEM format (string or Buffer).
    authPrivateKey?: JwtSecret;
    authPublicKey?: JwtSecret;

    // The default expiry for auth tokens in seconds
    authDefaultExpiry?: number;

    // The algorithm to use to sign and verify JWT tokens.
    authAlgorithm?: string;

    // Can be 1 or 2. Version 1 is for maximum backwards
    // compatibility with SocketCluster clients.
    protocolVersion?: 1 | 2;

    // In milliseconds - If the socket handshake hasn't been
    // completed before this timeout is reached, the new
    // connection attempt will be terminated.
    handshakeTimeout?: number;

    // In milliseconds, the timeout for receiving a response
    // when using invoke() or invokePublish().
    ackTimeout?: number;

    // Origins which are allowed to connect to the server.
    origins?: string;

    // The maximum number of unique channels which a single
    // socket can subscribe to.
    socketChannelLimit?: number;

    // The interval in milliseconds on which to
    // send a ping to the client to check that
    // it is still alive.
    pingInterval?: number;

    // How many milliseconds to wait without receiving a ping
    // before closing the socket.
    pingTimeout?: number;

    // Whether or not an error should be emitted on
    // the socket whenever an action is blocked by a
    // middleware function
    middlewareEmitFailures?: boolean;

    // The URL path reserved by SocketCluster clients to
    // interact with the server.
    path?: string;

    // Whether or not clients are allowed to publish messages
    // to channels.
    allowClientPublish?: boolean;

    // Whether or not to batch all socket messages
    // for some time immediately after completing
    // a handshake. This can be useful in failure-recovery
    // scenarios (e.g. batch resubscribe).
    batchOnHandshake?: boolean;

    // If batchOnHandshake is true, this lets you specify
    // How long to enable batching (in milliseconds) following
    // a successful socket handshake.
    batchOnHandshakeDuration?: number;

    // If batchOnHandshake is true, this lets you specify
    // the size of each batch in milliseconds.
    batchInterval?: number;

    // Lets you specify the default cleanup behaviour for
    // when a socket becomes disconnected.
    // Can be either 'kill' or 'close'. Kill mode means
    // that all of the socket's streams will be killed and
    // so consumption will stop immediately.
    // Close mode means that consumers on the socket will
    // be able to finish processing their stream backlogs
    // bebfore they are ended.
    socketStreamCleanupMode?: 'kill' | 'close';

    authVerifyAlgorithms?: string[];
    authEngine?: AuthEngineType;
    codecEngine?: CodecEngine;
    cloneData?: boolean;
    middlewareEmitWarnings?: boolean;

    [additionalOptions: string]: any;
}

export interface IncomingMessage {
    remoteAddress?: string;
    remoteFamily?: any;
    remotePort?: number;
    forwardedForAddress?: any;
}

export interface RequestObject
{
    socket?: any;
    authTokenExpiredError?: Error;
    channel?: string;
    data?: any;
    ackData?: any;
    event?: string;
    waitForAuth?: boolean;
}