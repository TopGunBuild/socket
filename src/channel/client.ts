import { ConsumerStats } from '../writable-consumable-stream/consumer-stats';
import { TGChannel } from './channel';
import { ChannelState } from './channel-state';

export interface TGChannelClient {
    closeChannel(channelName: string): void;

    killChannel(channelName: string): void;

    killChannelOutputConsumer(consumerId: number): void;
    killChannelListenerConsumer(consumerId: number): void;

    getChannelOutputConsumerStats(consumerId: number): ConsumerStats;
    getChannelListenerConsumerStats(consumerId: number): ConsumerStats;

    getChannelBackpressure(channelName: string): number;

    getChannelListenerConsumerBackpressure(consumerId: number): number;
    getChannelOutputConsumerBackpressure(consumerId: number): number;

    channelCloseOutput(channelName: string): void;
    channelCloseListener(channelName: string, eventName: string): void;
    channelCloseAllListeners(channelName: string): void;

    channelKillOutput(channelName: string): void;
    channelKillListener(channelName: string, eventName: string): void;
    channelKillAllListeners(channelName: string): void;

    channelGetOutputConsumerStatsList(channelName: string): ConsumerStats[];
    channelGetListenerConsumerStatsList(
        channelName: string,
        eventName: string
    ): ConsumerStats[];
    channelGetAllListenersConsumerStatsList(
        channelName: string
    ): ConsumerStats[];

    channelGetOutputBackpressure(channelName: string): number;
    channelGetListenerBackpressure(
        channelName: string,
        eventName: string
    ): number;
    channelGetAllListenersBackpressure(channelName: string): number;

    channelHasOutputConsumer(channelName: string, consumerId: number): boolean;
    channelHasListenerConsumer(
        channelName: string,
        eventName: string,
        consumerId: number
    ): boolean;
    channelHasAnyListenerConsumer(
        channelName: string,
        consumerId: number
    ): boolean;

    getChannelState(channelName: string): ChannelState;
    getChannelOptions(channelName: string): object;

    subscribe(channelName: string, options?: object): TGChannel<any>;
    unsubscribe(channelName: string): Promise<void>;
    isSubscribed(channelName: string, includePending?: boolean): boolean;

    transmitPublish(channelName: string, data: any): Promise<void>;
    invokePublish(channelName: string, data: any): Promise<any>;
}
