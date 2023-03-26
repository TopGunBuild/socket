import { AuthTokenExpiredError, InvalidActionError } from '../sc-errors/errors';
import { IncomingMessage, AuthToken } from './types';
import { AGServerSocket } from './server-socket';

const HANDSHAKE_WS = 'handshakeWS';
const HANDSHAKE_SC = 'handshakeSC';
const MESSAGE      = 'message';
const TRANSMIT     = 'transmit';
const INVOKE       = 'invoke';
const SUBSCRIBE    = 'subscribe';
const PUBLISH_IN   = 'publishIn';
const PUBLISH_OUT  = 'publishOut';
const AUTHENTICATE = 'authenticate';

export class AGAction
{
    static HANDSHAKE_WS: ActionType = HANDSHAKE_WS;
    static HANDSHAKE_SC: ActionType = HANDSHAKE_SC;
    static MESSAGE: ActionType      = MESSAGE;
    static TRANSMIT: ActionType     = TRANSMIT;
    static INVOKE: ActionType       = INVOKE;
    static SUBSCRIBE: ActionType    = SUBSCRIBE;
    static PUBLISH_IN: ActionType   = PUBLISH_IN;
    static PUBLISH_OUT: ActionType  = PUBLISH_OUT;
    static AUTHENTICATE: ActionType = AUTHENTICATE;

    type: ActionType;
    request?: IncomingMessage;
    socket?: AGServerSocket;
    authTokenExpiredError?: AuthTokenExpiredError;
    receiver?: string;
    procedure?: string;
    channel?: string;
    authToken?: AuthToken;
    signedAuthToken?: string;
    data?: any;

    readonly HANDSHAKE_WS: typeof HANDSHAKE_WS;
    readonly HANDSHAKE_SC: typeof HANDSHAKE_SC;
    readonly MESSAGE: typeof MESSAGE;
    readonly TRANSMIT: typeof TRANSMIT;
    readonly INVOKE: typeof INVOKE;
    readonly SUBSCRIBE: typeof SUBSCRIBE;
    readonly PUBLISH_IN: typeof PUBLISH_IN;
    readonly PUBLISH_OUT: typeof PUBLISH_OUT;
    readonly AUTHENTICATE: typeof AUTHENTICATE;

    outcome: null|'allowed'|'blocked';
    promise: Promise<any>;
    private _resolve: (value?: (PromiseLike<any>|any)) => void;
    private _reject: (reason?: any) => void;

    /**
     * Constructor
     */
    constructor()
    {
        this.outcome = null;

        this.HANDSHAKE_WS = HANDSHAKE_WS;
        this.HANDSHAKE_SC = HANDSHAKE_SC;
        this.MESSAGE      = MESSAGE;
        this.TRANSMIT     = TRANSMIT;
        this.INVOKE       = INVOKE;
        this.SUBSCRIBE    = SUBSCRIBE;
        this.PUBLISH_IN   = PUBLISH_IN;
        this.PUBLISH_OUT  = PUBLISH_OUT;
        this.AUTHENTICATE = AUTHENTICATE;

        this.promise = new Promise((resolve, reject) =>
        {
            this._resolve = resolve;
            this._reject  = reject;
        });
    }

    // -----------------------------------------------------------------------------------------------------
    // @ Public methods
    // -----------------------------------------------------------------------------------------------------

    allow(packet: any): void
    {
        if (this.outcome)
        {
            throw new InvalidActionError(`AGAction ${this.type} has already been ${this.outcome}; cannot allow`);
        }
        this.outcome = 'allowed';
        this._resolve(packet);
    }

    block(error: Error): void
    {
        if (this.outcome)
        {
            throw new InvalidActionError(`AGAction ${this.type} has already been ${this.outcome}; cannot block`);
        }
        this.outcome = 'blocked';
        this._reject(error);
    }
}

export type ActionType =
    |typeof HANDSHAKE_WS
    |typeof HANDSHAKE_SC
    |typeof MESSAGE
    |typeof TRANSMIT
    |typeof INVOKE
    |typeof SUBSCRIBE
    |typeof PUBLISH_IN
    |typeof PUBLISH_OUT
    |typeof AUTHENTICATE;

export interface AGActionBase
{
    readonly HANDSHAKE_WS: typeof HANDSHAKE_WS;
    readonly HANDSHAKE_SC: typeof HANDSHAKE_SC;
    readonly MESSAGE: typeof MESSAGE;
    readonly TRANSMIT: typeof TRANSMIT;
    readonly INVOKE: typeof INVOKE;
    readonly SUBSCRIBE: typeof SUBSCRIBE;
    readonly PUBLISH_IN: typeof PUBLISH_IN;
    readonly PUBLISH_OUT: typeof PUBLISH_OUT;
    readonly AUTHENTICATE: typeof AUTHENTICATE;

    outcome: null|'allowed'|'blocked';
    promise: Promise<any>;

    allow(packet?: any): void;

    block(error?: Error): void;
}

export interface AGActionHandshakeWS extends AGActionBase
{
    type: typeof HANDSHAKE_WS;
}

export interface AGActionHandshakeSC extends AGActionBase
{
    type: typeof HANDSHAKE_SC;
    request: IncomingMessage;
    socket: AGServerSocket;
}

export interface AGActionMessage extends AGActionBase
{
    type: typeof MESSAGE;
    socket: AGServerSocket;
    data: any;
}

export interface AGActionTransmit extends AGActionBase
{
    type: typeof TRANSMIT;
    socket: AGServerSocket;
    authTokenExpiredError?: AuthTokenExpiredError;
    receiver: string;
    data?: any;
}

export interface AGActionInvoke extends AGActionBase
{
    type: typeof INVOKE;
    socket: AGServerSocket;
    authTokenExpiredError?: AuthTokenExpiredError;
    procedure: string;
    data?: any;
}

export interface AGActionSubscribe extends AGActionBase
{
    type: typeof SUBSCRIBE;
    socket: AGServerSocket;
    authTokenExpiredError?: AuthTokenExpiredError;
    channel?: string;
    data?: any;
}

export interface AGActionPublishIn extends AGActionBase
{
    type: typeof PUBLISH_IN;
    socket: AGServerSocket;
    authTokenExpiredError?: AuthTokenExpiredError;
    channel?: string;
    data?: any;
}

export interface AGActionPublishOut extends AGActionBase
{
    type: typeof PUBLISH_OUT;
    socket: AGServerSocket;
    channel?: string;
    data?: any;
}

export interface AGActionAuthenticate extends AGActionBase
{
    type: typeof AUTHENTICATE;
    socket: AGServerSocket;
    authToken?: AuthToken;
    signedAuthToken?: string;
}
