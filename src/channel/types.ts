export type ChannelState = 'pending' | 'subscribed' | 'unsubscribed';

export type HandlerFunction = (data: any) => void;

export interface SCChannelOptions {
    waitForAuth?: boolean | undefined;
    batch?: boolean | undefined;
    data?: any;
}
