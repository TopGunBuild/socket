import { AsyncStreamEmitter } from '../async-stream-emitter';
import { StreamDemux } from '../stream-demux';
import { AGChannelClient } from '../ag-channel/client';
import { AGSimpleBroker } from './simple-broker';
import { AGChannel } from '../ag-channel/channel';
import { ConsumerStats } from '../writable-consumable-stream/consumer-stats';
import { ChannelState } from '../ag-channel/channel-state';

export class SimpleExchange extends AsyncStreamEmitter<any> implements AGChannelClient
{
    id: string;
    private _broker: AGSimpleBroker;
    private readonly _channelMap: {[key: string]: any};
    private readonly _channelEventDemux: StreamDemux<unknown>;
    private readonly _channelDataDemux: StreamDemux<unknown>;

    /**
     * Constructor
     */
    constructor(broker: AGSimpleBroker)
    {
        super();
        this.id                 = 'exchange';
        this._broker            = broker;
        this._channelMap        = {};
        this._channelEventDemux = new StreamDemux();
        this._channelDataDemux  = new StreamDemux();
    }

    // -----------------------------------------------------------------------------------------------------
    // @ Public methods
    // -----------------------------------------------------------------------------------------------------

    transmit(event: string, packet: any): void
    {
        if (event === '#publish')
        {
            this._channelDataDemux.write(packet.channel, packet.data);
        }
    }

    getBackpressure(): number
    {
        return Math.max(
            this.getAllListenersBackpressure(),
            this.getAllChannelsBackpressure()
        );
    }

    destroy(): void
    {
        this._broker.closeAllListeners();
    }

    async transmitPublish(channelName: string, data: any): Promise<void>
    {
        return this._broker.transmitPublish(channelName, data);
    }

    async invokePublish(channelName: string, data: any): Promise<void>
    {
        return this._broker.invokePublish(channelName, data);
    }

    subscribe(channelName: string): AGChannel<any>
    {
        let channel = this._channelMap[channelName];

        if (!channel)
        {
            channel                       = {
                name : channelName,
                state: AGChannel.PENDING
            };
            this._channelMap[channelName] = channel;
            this._triggerChannelSubscribe(channel);
        }

        let channelIterable = new AGChannel(
            channelName,
            this,
            this._channelEventDemux,
            this._channelDataDemux
        );

        return channelIterable;
    }

    async unsubscribe(channelName: string): Promise<void>
    {
        let channel = this._channelMap[channelName];

        if (channel)
        {
            this._triggerChannelUnsubscribe(channel);
        }
    }

    channel(channelName: string): AGChannel<any>
    {
        let currentChannel = this._channelMap[channelName];

        let channelIterable = new AGChannel(
            channelName,
            this,
            this._channelEventDemux,
            this._channelDataDemux
        );

        return channelIterable;
    }

    closeChannel(channelName: string): void
    {
        this.channelCloseOutput(channelName);
        this.channelCloseAllListeners(channelName);
    }

    closeAllChannelOutputs(): void
    {
        this._channelDataDemux.closeAll();
    }

    closeAllChannelListeners(): void
    {
        this._channelEventDemux.closeAll();
    }

    closeAllChannels(): void
    {
        this.closeAllChannelOutputs();
        this.closeAllChannelListeners();
    }

    killChannel(channelName: string): void
    {
        this.channelKillOutput(channelName);
        this.channelKillAllListeners(channelName);
    }

    killAllChannelOutputs(): void
    {
        this._channelDataDemux.killAll();
    }

    killAllChannelListeners(): void
    {
        this._channelEventDemux.killAll();
    }

    killAllChannels(): void
    {
        this.killAllChannelOutputs();
        this.killAllChannelListeners();
    }

    killChannelOutputConsumer(consumerId: number): void
    {
        this._channelDataDemux.killConsumer(consumerId);
    }

    killChannelListenerConsumer(consumerId: number): void
    {
        this._channelEventDemux.killConsumer(consumerId);
    }

    getChannelOutputConsumerStats(consumerId: number): ConsumerStats
    {
        return this._channelDataDemux.getConsumerStats(consumerId);
    }

    getChannelListenerConsumerStats(consumerId: number): ConsumerStats
    {
        return this._channelEventDemux.getConsumerStats(consumerId);
    }

    getAllChannelOutputsConsumerStatsList(): ConsumerStats[]
    {
        return this._channelDataDemux.getConsumerStatsListAll();
    }

    getAllChannelListenersConsumerStatsList(): ConsumerStats[]
    {
        return this._channelEventDemux.getConsumerStatsListAll();
    }

    getChannelBackpressure(channelName: string): number
    {
        return Math.max(
            this.channelGetOutputBackpressure(channelName),
            this.channelGetAllListenersBackpressure(channelName)
        );
    }

    getAllChannelOutputsBackpressure(): number
    {
        return this._channelDataDemux.getBackpressureAll();
    }

    getAllChannelListenersBackpressure(): number
    {
        return this._channelEventDemux.getBackpressureAll();
    }

    getAllChannelsBackpressure(): number
    {
        return Math.max(
            this.getAllChannelOutputsBackpressure(),
            this.getAllChannelListenersBackpressure()
        );
    }

    getChannelListenerConsumerBackpressure(consumerId: number): number
    {
        return this._channelEventDemux.getConsumerBackpressure(consumerId);
    }

    getChannelOutputConsumerBackpressure(consumerId: number): number
    {
        return this._channelDataDemux.getConsumerBackpressure(consumerId);
    }

    hasAnyChannelOutputConsumer(consumerId: number): boolean
    {
        return this._channelDataDemux.hasConsumerAll(consumerId);
    }

    hasAnyChannelListenerConsumer(consumerId: number): boolean
    {
        return this._channelEventDemux.hasConsumerAll(consumerId);
    }

    getChannelState(channelName: string): ChannelState
    {
        let channel = this._channelMap[channelName];
        if (channel)
        {
            return channel.state;
        }
        return AGChannel.UNSUBSCRIBED;
    }

    getChannelOptions(channelName: string): object
    {
        return {};
    }

    channelCloseOutput(channelName: string): void
    {
        this._channelDataDemux.close(channelName);
    }

    channelCloseListener(channelName: string, eventName: string): void
    {
        this._channelEventDemux.close(`${channelName}/${eventName}`);
    }

    channelCloseAllListeners(channelName: string): void
    {
        let listenerStreams = this._getAllChannelStreamNames(channelName)
            .forEach((streamName) =>
            {
                this._channelEventDemux.close(streamName);
            });
    }

    channelKillOutput(channelName: string): void
    {
        this._channelDataDemux.kill(channelName);
    }

    channelKillListener(channelName: string, eventName: string): void
    {
        this._channelEventDemux.kill(`${channelName}/${eventName}`);
    }

    channelKillAllListeners(channelName: string): void
    {
        let listenerStreams = this._getAllChannelStreamNames(channelName)
            .forEach((streamName) =>
            {
                this._channelEventDemux.kill(streamName);
            });
    }

    channelGetOutputConsumerStatsList(channelName: string): ConsumerStats[]
    {
        return this._channelDataDemux.getConsumerStatsList(channelName);
    }

    channelGetListenerConsumerStatsList(channelName: string, eventName: string): ConsumerStats[]
    {
        return this._channelEventDemux.getConsumerStatsList(`${channelName}/${eventName}`);
    }

    channelGetAllListenersConsumerStatsList(channelName: string): ConsumerStats[]
    {
        return this._getAllChannelStreamNames(channelName)
            .map((streamName) =>
            {
                return this._channelEventDemux.getConsumerStatsList(streamName);
            })
            .reduce((accumulator, statsList) =>
            {
                statsList.forEach((stats) =>
                {
                    accumulator.push(stats);
                });
                return accumulator;
            }, []);
    }

    channelGetOutputBackpressure(channelName: string): number
    {
        return this._channelDataDemux.getBackpressure(channelName);
    }

    channelGetListenerBackpressure(channelName: string, eventName: string): number
    {
        return this._channelEventDemux.getBackpressure(`${channelName}/${eventName}`);
    }

    channelGetAllListenersBackpressure(channelName: string): number
    {
        let listenerStreamBackpressures = this._getAllChannelStreamNames(channelName)
            .map((streamName) =>
            {
                return this._channelEventDemux.getBackpressure(streamName);
            });
        return Math.max(...listenerStreamBackpressures.concat(0));
    }

    channelHasOutputConsumer(channelName: string, consumerId: number): boolean
    {
        return this._channelDataDemux.hasConsumer(channelName, consumerId);
    }

    channelHasListenerConsumer(channelName: string, eventName: string, consumerId: number): boolean
    {
        return this._channelEventDemux.hasConsumer(`${channelName}/${eventName}`, consumerId);
    }

    channelHasAnyListenerConsumer(channelName: string, consumerId: number): boolean
    {
        return this._getAllChannelStreamNames(channelName)
            .some((streamName) =>
            {
                return this._channelEventDemux.hasConsumer(streamName, consumerId);
            });
    }

    subscriptions(includePending?: boolean): string[]
    {
        let subs = [];
        Object.keys(this._channelMap).forEach((channelName) =>
        {
            if (includePending || this._channelMap[channelName].state === AGChannel.SUBSCRIBED)
            {
                subs.push(channelName);
            }
        });
        return subs;
    }

    isSubscribed(channelName: string, includePending?: boolean): boolean
    {
        let channel = this._channelMap[channelName];
        if (includePending)
        {
            return !!channel;
        }
        return !!channel && channel.state === AGChannel.SUBSCRIBED;
    }

    // -----------------------------------------------------------------------------------------------------
    // @ Private methods
    // -----------------------------------------------------------------------------------------------------

    private _triggerChannelSubscribe(channel): void
    {
        let channelName = channel.name;

        channel.state = AGChannel.SUBSCRIBED;

        this._channelEventDemux.write(`${channelName}/subscribe`, {});
        this._broker.subscribeClient(this, channelName);
        this.emit('subscribe', { channel: channelName });
    }

    private _triggerChannelUnsubscribe(channel): void
    {
        let channelName = channel.name;

        delete this._channelMap[channelName];
        if (channel.state === AGChannel.SUBSCRIBED)
        {
            this._channelEventDemux.write(`${channelName}/unsubscribe`, {});
            this._broker.unsubscribeClient(this, channelName);
            this.emit('unsubscribe', { channel: channelName });
        }
    }

    private _getAllChannelStreamNames(channelName: string): string[]
    {
        let streamNamesLookup = this._channelEventDemux.getConsumerStatsListAll()
            .filter((stats) =>
            {
                return stats.stream.indexOf(`${channelName}/`) === 0;
            })
            .reduce((accumulator, stats) =>
            {
                accumulator[stats.stream] = true;
                return accumulator;
            }, {});
        return Object.keys(streamNamesLookup);
    }
}