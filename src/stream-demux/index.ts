import { WritableConsumableStream } from "../writable-consumable-stream";
import { Consumer } from "../writable-consumable-stream/consumer";
import { ConsumerStats } from "../writable-consumable-stream/consumer-stats";
import { DemuxedConsumableStream } from "./demuxed-consumable-stream";

interface StreamDemuxValue<T> {
    stream?: string;
    consumerId?: number;
    data: { value: T; done: boolean };
}

export class StreamDemux<T> {
    private _mainStream: WritableConsumableStream<StreamDemuxValue<T> | T>;

    /**
     * Constructor
     */
    constructor() {
        this._mainStream = new WritableConsumableStream<StreamDemuxValue<T>>();
    }

    write(streamName: string, value: T): void {
        this._mainStream.write({
            stream: streamName,
            data: {
                value,
                done: false,
            },
        });
    }

    close(streamName: string, value?: T): void {
        this._mainStream.write({
            stream: streamName,
            data: {
                value,
                done: true,
            },
        });
    }

    closeAll(value?: T): void {
        this._mainStream.close(value);
    }

    writeToConsumer(consumerId: number, value: T): void {
        this._mainStream.writeToConsumer(consumerId, {
            consumerId,
            data: {
                value,
                done: false,
            },
        });
    }

    closeConsumer(consumerId: number, value: T): void {
        this._mainStream.closeConsumer(consumerId, {
            consumerId,
            data: {
                value,
                done: true,
            },
        });
    }

    getConsumerStats(consumerId: number): ConsumerStats {
        return this._mainStream.getConsumerStats(consumerId);
    }

    getConsumerStatsList(streamName: string): ConsumerStats[] {
        let consumerList = this._mainStream.getConsumerStatsList();
        return consumerList.filter((consumerStats) => {
            return consumerStats.stream === streamName;
        });
    }

    getConsumerStatsListAll(): ConsumerStats[] {
        return this._mainStream.getConsumerStatsList();
    }

    kill(streamName: string, value?: T): void {
        let consumerList = this.getConsumerStatsList(streamName);
        let len = consumerList.length;
        for (let i = 0; i < len; i++) {
            this.killConsumer(consumerList[i].id, value);
        }
    }

    killAll(value?: T): void {
        this._mainStream.kill(value);
    }

    killConsumer(consumerId: number, value?: T): void {
        this._mainStream.killConsumer(consumerId, value);
    }

    getBackpressure(streamName: string): number {
        let consumerList = this.getConsumerStatsList(streamName);
        let len = consumerList.length;

        let maxBackpressure = 0;
        for (let i = 0; i < len; i++) {
            let consumer = consumerList[i];
            if (consumer.backpressure > maxBackpressure) {
                maxBackpressure = consumer.backpressure;
            }
        }
        return maxBackpressure;
    }

    getBackpressureAll(): number {
        return this._mainStream.getBackpressure();
    }

    getConsumerBackpressure(consumerId: number): number {
        return this._mainStream.getConsumerBackpressure(consumerId);
    }

    hasConsumer(streamName: string, consumerId: number): boolean {
        let consumerStats = this._mainStream.getConsumerStats(consumerId);
        return !!consumerStats && consumerStats.stream === streamName;
    }

    hasConsumerAll(consumerId: number): boolean {
        return this._mainStream.hasConsumer(consumerId);
    }

    getConsumerCount(streamName: string): number {
        return this.getConsumerStatsList(streamName).length;
    }

    getConsumerCountAll(): number {
        return this.getConsumerStatsListAll().length;
    }

    createConsumer(
        streamName: string,
        timeout: any
    ): Consumer<StreamDemuxValue<T> | T> {
        let mainStreamConsumer = this._mainStream.createConsumer(timeout);

        let consumerNext = mainStreamConsumer.next;
        mainStreamConsumer.next = async function () {
            while (true) {
                let packet = await consumerNext.apply(this, arguments);
                if (packet.value) {
                    if (
                        packet.value.stream === streamName ||
                        packet.value.consumerId === this.id
                    ) {
                        if (packet.value.data.done) {
                            this.return();
                        }
                        return packet.value.data;
                    }
                }
                if (packet.done) {
                    return packet;
                }
            }
        };

        let consumerGetStats = mainStreamConsumer.getStats;
        mainStreamConsumer.getStats = function () {
            let stats = consumerGetStats.apply(this, arguments);
            stats.stream = streamName;
            return stats;
        };

        let consumerApplyBackpressure = mainStreamConsumer.applyBackpressure;
        mainStreamConsumer.applyBackpressure = function (packet) {
            if (packet.value) {
                if (
                    packet.value.stream === streamName ||
                    packet.value.consumerId === this.id
                ) {
                    consumerApplyBackpressure.apply(this, arguments);

                    return;
                }
            }
            if (packet.done) {
                consumerApplyBackpressure.apply(this, arguments);
            }
        };

        let consumerReleaseBackpressure =
            mainStreamConsumer.releaseBackpressure;
        mainStreamConsumer.releaseBackpressure = function (packet) {
            if (packet.value) {
                if (
                    packet.value.stream === streamName ||
                    packet.value.consumerId === this.id
                ) {
                    consumerReleaseBackpressure.apply(this, arguments);

                    return;
                }
            }
            if (packet.done) {
                consumerReleaseBackpressure.apply(this, arguments);
            }
        };

        return mainStreamConsumer;
    }

    stream(streamName: string): DemuxedConsumableStream<T> {
        return new DemuxedConsumableStream(this, streamName);
    }
}
