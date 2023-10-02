export type ChannelState = 'pending' | 'subscribed' | 'unsubscribed';

export interface TGChannelOptions {
    waitForAuth?: boolean | undefined;
    batch?: boolean | undefined;
    data?: any;
    channel?: string;
}
