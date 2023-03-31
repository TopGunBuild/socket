import { AuthTokenExpiredError, InvalidActionError } from '../errors/errors';
import { IncomingMessage, AuthToken } from './types';
import { TGServerSocket } from './server-socket';

const HANDSHAKE_WS = 'handshakeWS';
const HANDSHAKE_SC = 'handshakeSC';
const MESSAGE      = 'message';
const TRANSMIT     = 'transmit';
const INVOKE       = 'invoke';
const SUBSCRIBE    = 'subscribe';
const PUBLISH_IN   = 'publishIn';
const PUBLISH_OUT  = 'publishOut';
const AUTHENTICATE = 'authenticate';

export class TGAction
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
    socket?: TGServerSocket;
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

export interface TGActionBase
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

export interface TGActionHandshakeWS extends TGActionBase
{
    type: typeof HANDSHAKE_WS;
}

export interface TGActionHandshakeSC extends TGActionBase
{
    type: typeof HANDSHAKE_SC;
    request: IncomingMessage;
    socket: TGServerSocket;
}

export interface TGActionMessage extends TGActionBase
{
    type: typeof MESSAGE;
    socket: TGServerSocket;
    data: any;
}

export interface TGActionTransmit extends TGActionBase
{
    type: typeof TRANSMIT;
    socket: TGServerSocket;
    authTokenExpiredError?: AuthTokenExpiredError;
    receiver: string;
    data?: any;
}

export interface TGActionInvoke extends TGActionBase
{
    type: typeof INVOKE;
    socket: TGServerSocket;
    authTokenExpiredError?: AuthTokenExpiredError;
    procedure: string;
    data?: any;
}

export interface TGActionSubscribe extends TGActionBase
{
    type: typeof SUBSCRIBE;
    socket: TGServerSocket;
    authTokenExpiredError?: AuthTokenExpiredError;
    channel?: string;
    data?: any;
}

export interface TGActionPublishIn extends TGActionBase
{
    type: typeof PUBLISH_IN;
    socket: TGServerSocket;
    authTokenExpiredError?: AuthTokenExpiredError;
    channel?: string;
    data?: any;
}

export interface TGActionPublishOut extends TGActionBase
{
    type: typeof PUBLISH_OUT;
    socket: TGServerSocket;
    channel?: string;
    data?: any;
}

export interface TGActionAuthenticate extends TGActionBase
{
    type: typeof AUTHENTICATE;
    socket: TGServerSocket;
    authToken?: AuthToken;
    signedAuthToken?: string;
}
