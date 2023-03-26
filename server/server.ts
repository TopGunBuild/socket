import { AsyncStreamEmitter } from '../async-stream-emitter';
import { AGServerOptions } from './types';
import { AGServerSocket } from './server-socket';
import { SimpleExchange } from '../ag-simple-broker/simple-exchange';
import { Secret } from '../jwt';
import { AGSimpleBroker } from '../ag-simple-broker/simple-broker';

const MIDDLEWARE_HANDSHAKE = 'handshake';
const MIDDLEWARE_INBOUND_RAW = 'inboundRaw';
const MIDDLEWARE_INBOUND = 'inbound';
const MIDDLEWARE_OUTBOUND = 'outbound';

export class AGServer extends AsyncStreamEmitter<any>
{
    readonly MIDDLEWARE_HANDSHAKE: typeof MIDDLEWARE_HANDSHAKE;
    readonly MIDDLEWARE_INBOUND_RAW: typeof MIDDLEWARE_INBOUND_RAW;
    readonly MIDDLEWARE_INBOUND: typeof MIDDLEWARE_INBOUND;
    readonly MIDDLEWARE_OUTBOUND: typeof MIDDLEWARE_OUTBOUND;
    readonly SYMBOL_MIDDLEWARE_HANDSHAKE_STREAM: symbol;

    options: AGServerOptions;
    origins: string;
    ackTimeout: number;
    handshakeTimeout: number;
    pingInterval: number;
    pingTimeout: number;
    pingTimeoutDisabled: boolean;
    allowClientPublish: boolean;
    perMessageDeflate?: boolean | {};
    httpServer: any;
    socketChannelLimit?: number;
    protocolVersion: 1 | 2;
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

    /**
     * Constructor
     */
    constructor(options?: AGServerOptions)
    {
        super();
    }
}