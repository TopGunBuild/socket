import { JwtSignOptions } from 'topgun-jsonwebtoken';
import { JwtPayload } from 'topgun-jsonwebtoken';
import { AuthEngine } from '../auth';

export interface EventObject
{
    id?: any;
    useCache?: boolean;
    channel?: string;
    pingTimeout?: number;
    socket?: any;
    event?: string;
    data?: any;
    callback?: EventObjectCallback|undefined;
    cid?: number|undefined;
    timeout?: any;
    rid?: any;
    error?: any;
    authToken?: any;
    authError?: any;
    isAuthenticated?: boolean;
    authTokenExpiredError?: Error;
    signedAuthToken?: string;
}

export type EventObjectCallback = (
    error: Error,
    eventObject: EventObject
) => void;

export type SocketState = 'connecting'|'open'|'closed';
export type AuthState = 'authenticated'|'unauthenticated';

export interface AuthStateChangeData
{
    oldAuthState: AuthState;
    newAuthState: AuthState;
    authToken?: AuthToken;
}

export interface AuthTokenOptions extends JwtSignOptions
{
    rejectOnFailedDelivery?: boolean;
    mutatePayload?: any;
}

export type AuthEngineType = Pick<AuthEngine, "verifyToken" | "signToken">;

export interface CodecEngine {
    decode: (input: any) => any;
    encode: (object: any) => any;
}

export const MIDDLEWARE_HANDSHAKE = 'handshake';
export const MIDDLEWARE_INBOUND_RAW = 'inboundRaw';
export const MIDDLEWARE_INBOUND = 'inbound';
export const MIDDLEWARE_OUTBOUND = 'outbound';

export type Middlewares =
    | typeof MIDDLEWARE_HANDSHAKE
    | typeof MIDDLEWARE_INBOUND_RAW
    | typeof MIDDLEWARE_INBOUND
    | typeof MIDDLEWARE_OUTBOUND;

export type MiddlewareFunction = (request: any) => Promise<void>;

export interface AuthToken extends JwtPayload {
    [x: string]: any;
}

