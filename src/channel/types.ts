export type ChannelState = 'pending' | 'subscribed' | 'unsubscribed';

export interface SCChannelOptions {
    waitForAuth?: boolean | undefined;
    batch?: boolean | undefined;
    data?: any;
}
