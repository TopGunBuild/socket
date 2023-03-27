import { AuthToken } from '../socket-server/types';

export interface TransportHandlers {
    onOpen: (value?: OnOpenValue) => void;
    onOpenAbort: (value: OnOpenAbortValue) => void;
    onClose: (value: OnCloseValue) => void;
    onEvent: (value: OnEventValue) => void;
    onError: (value: OnErrorValue) => void;
    onInboundInvoke: (value: OnInboundInvokeValue) => void;
    onInboundTransmit: (value: OnInboundTransmitValue) => void;
}

export interface OnOpenValue {
    id: string;
    pingTimeout: number;
    isAuthenticated: boolean;
    authToken: AuthToken | null;
}

export interface OnOpenAbortValue {
    code: number;
    reason: string;
}

export interface OnCloseValue {
    code: number;
    reason: string;
}

export interface OnEventValue {
    event: string;
    data: any;
}

export interface OnErrorValue {
    error: Error;
}

export interface OnInboundInvokeValue {
    procedure: string;
    data: any;
}

export interface OnInboundTransmitValue {
    event: string;
    data: any;
}

export interface EventObject {
    event: string;
    data: any;
    callback?: EventObjectCallback | undefined;
    cid?: number | undefined;
    timeout?: any;
    rid?: any;
    error?: any;
}

export interface TransmitOptions {
    force?: boolean | undefined;
}

export interface InvokeOptions {
    force?: boolean | undefined;
    noTimeout?: boolean | undefined;
    ackTimeout?: number | undefined;
}

export type EventObjectCallback = (error: Error, eventObject: EventObject) => void;
