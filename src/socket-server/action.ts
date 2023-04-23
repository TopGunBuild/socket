import { AuthTokenExpiredError, InvalidActionError } from '../errors/errors';
import { AuthToken } from '../types';
import { TGServerSocket } from './server-socket';
import { IncomingMessage } from './types';

const HANDSHAKE_WS = 'handshakeWS';
const HANDSHAKE_SC = 'handshakeSC';
const MESSAGE      = 'message';
const TRANSMIT     = 'transmit';
const INVOKE       = 'invoke';
const SUBSCRIBE    = 'subscribe';
const PUBLISH_IN   = 'publishIn';
const PUBLISH_OUT  = 'publishOut';
const AUTHENTICATE = 'authenticate';

export interface ITGAction
{
    type: ActionType;
    request?: IncomingMessage;
    socket?: TGServerSocket;
    authTokenExpiredError?: typeof AuthTokenExpiredError;
    receiver?: string;
    procedure?: string;
    channel?: string;
    authToken?: AuthToken;
    signedAuthToken?: string;
    data?: any;

    HANDSHAKE_WS: typeof HANDSHAKE_WS;
    HANDSHAKE_SC: typeof HANDSHAKE_SC;
    MESSAGE: typeof MESSAGE;
    TRANSMIT: typeof TRANSMIT;
    INVOKE: typeof INVOKE;
    SUBSCRIBE: typeof SUBSCRIBE;
    PUBLISH_IN: typeof PUBLISH_IN;
    PUBLISH_OUT: typeof PUBLISH_OUT;
    AUTHENTICATE: typeof AUTHENTICATE;

    outcome: null|'allowed'|'blocked';
    promise: Promise<any>;
    _resolve: (value?: PromiseLike<any>|any) => void;
    _reject: (reason?: any) => void;

    allow(packet: any): void

    block(error: Error): void
}

export function TGAction()
{
    this.outcome = null;
    this.request = null;
    this.socket = null;
    this.authTokenExpiredError = null;
    this.receiver = null;
    this.procedure = null;
    this.channel = null;
    this.authToken = null;
    this.signedAuthToken = null;
    this.data = null;

    this.promise = new Promise((resolve, reject) => {
        this._resolve = resolve;
        this._reject = reject;
    });

    this.allow = (packet: any) => {
        if (this.outcome) {
            throw new InvalidActionError(`TGAction ${this.type} has already been ${this.outcome}; cannot allow`);
        }
        this.outcome = 'allowed';
        this._resolve(packet);
    };

    this.block = (error: Error) => {
        if (this.outcome) {
            throw new InvalidActionError(`TGAction ${this.type} has already been ${this.outcome}; cannot block`);
        }
        this.outcome = 'blocked';
        this._reject(error);
    };
}

TGAction.prototype.HANDSHAKE_WS = TGAction.HANDSHAKE_WS = 'handshakeWS';
TGAction.prototype.HANDSHAKE_SC = TGAction.HANDSHAKE_SC = 'handshakeSC';

TGAction.prototype.MESSAGE = TGAction.MESSAGE = 'message';

TGAction.prototype.TRANSMIT = TGAction.TRANSMIT = 'transmit';
TGAction.prototype.INVOKE = TGAction.INVOKE = 'invoke';
TGAction.prototype.SUBSCRIBE = TGAction.SUBSCRIBE = 'subscribe';
TGAction.prototype.PUBLISH_IN = TGAction.PUBLISH_IN = 'publishIn';
TGAction.prototype.PUBLISH_OUT = TGAction.PUBLISH_OUT = 'publishOut';
TGAction.prototype.AUTHENTICATE = TGAction.AUTHENTICATE = 'authenticate';

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
    authTokenExpiredError?: typeof AuthTokenExpiredError;
    receiver: string;
    data?: any;
}

export interface TGActionInvoke extends TGActionBase
{
    type: typeof INVOKE;
    socket: TGServerSocket;
    authTokenExpiredError?: typeof AuthTokenExpiredError;
    procedure: string;
    data?: any;
}

export interface TGActionSubscribe extends TGActionBase
{
    type: typeof SUBSCRIBE;
    socket: TGServerSocket;
    authTokenExpiredError?: typeof AuthTokenExpiredError;
    channel?: string;
    data?: any;
}

export interface TGActionPublishIn extends TGActionBase
{
    type: typeof PUBLISH_IN;
    socket: TGServerSocket;
    authTokenExpiredError?: typeof AuthTokenExpiredError;
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
