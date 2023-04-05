import { ConsumableStream, ConsumableStreamConsumer } from "../consumable-stream";
import { StreamDemux } from "../stream-demux";
import { DemuxedConsumableStream } from "../stream-demux/demuxed-consumable-stream";
import { ConsumerStats } from "../writable-consumable-stream/consumer-stats";
import { ChannelState } from "./channel-state";
import { TGChannelClient } from "./client";

export class TGChannel<T> extends ConsumableStream<T> {
  static PENDING: ChannelState = "pending";
  static SUBSCRIBED: ChannelState = "subscribed";
  static UNSUBSCRIBED: ChannelState = "unsubscribed";

  name: string;
  PENDING: ChannelState;
  SUBSCRIBED: ChannelState;
  UNSUBSCRIBED: ChannelState;
  client: TGChannelClient;

  _eventDemux: StreamDemux<T>;
  _dataStream: DemuxedConsumableStream<T>;
  _pendingSubscriptionCid: number;

  /**
   * Constructor
   */
  constructor(name: string, client: TGChannelClient, eventDemux: StreamDemux<T>, dataDemux: StreamDemux<T>) {
    super();
    this.PENDING = TGChannel.PENDING;
    this.SUBSCRIBED = TGChannel.SUBSCRIBED;
    this.UNSUBSCRIBED = TGChannel.UNSUBSCRIBED;

    this.name = name;
    this.client = client;

    this._eventDemux = eventDemux;
    this._dataStream = dataDemux.stream(this.name);
  }

  // -----------------------------------------------------------------------------------------------------
  // @ Accessors
  // -----------------------------------------------------------------------------------------------------

  get state(): ChannelState {
    return this.client.getChannelState(this.name);
  }

  set state(value) {
    throw new Error("Cannot directly set channel state");
  }

  get options(): object {
    return this.client.getChannelOptions(this.name);
  }

  set options(value) {
    throw new Error("Cannot directly set channel options");
  }

  // -----------------------------------------------------------------------------------------------------
  // @ Public methods
  // -----------------------------------------------------------------------------------------------------

  createConsumer(timeout?: number): ConsumableStreamConsumer<T> {
    return this._dataStream.createConsumer(timeout);
  }

  listener(eventName: string): DemuxedConsumableStream<T> {
    return this._eventDemux.stream(`${this.name}/${eventName}`);
  }

  close(): void {
    this.client.closeChannel(this.name);
  }

  kill(): void {
    this.client.killChannel(this.name);
  }

  killOutputConsumer(consumerId: number): void {
    if (this.hasOutputConsumer(consumerId)) {
      this.client.killChannelOutputConsumer(consumerId);
    }
  }

  killListenerConsumer(consumerId: number): void {
    if (this.hasAnyListenerConsumer(consumerId)) {
      this.client.killChannelListenerConsumer(consumerId);
    }
  }

  getOutputConsumerStats(consumerId: number): ConsumerStats | undefined {
    if (this.hasOutputConsumer(consumerId)) {
      return this.client.getChannelOutputConsumerStats(consumerId);
    }
    return undefined;
  }

  getListenerConsumerStats(consumerId: number): ConsumerStats | undefined {
    if (this.hasAnyListenerConsumer(consumerId)) {
      return this.client.getChannelListenerConsumerStats(consumerId);
    }
    return undefined;
  }

  getBackpressure(): number {
    return this.client.getChannelBackpressure(this.name);
  }

  getListenerConsumerBackpressure(consumerId: number): number {
    if (this.hasAnyListenerConsumer(consumerId)) {
      return this.client.getChannelListenerConsumerBackpressure(consumerId);
    }
    return 0;
  }

  getOutputConsumerBackpressure(consumerId: number): any {
    if (this.hasOutputConsumer(consumerId)) {
      return this.client.getChannelOutputConsumerBackpressure(consumerId);
    }
    return 0;
  }

  closeOutput(): void {
    this.client.channelCloseOutput(this.name);
  }

  closeListener(eventName: string): void {
    this.client.channelCloseListener(this.name, eventName);
  }

  closeAllListeners(): void {
    this.client.channelCloseAllListeners(this.name);
  }

  killOutput(): void {
    this.client.channelKillOutput(this.name);
  }

  killListener(eventName: string): void {
    this.client.channelKillListener(this.name, eventName);
  }

  killAllListeners(): void {
    this.client.channelKillAllListeners(this.name);
  }

  getOutputConsumerStatsList(): ConsumerStats[] {
    return this.client.channelGetOutputConsumerStatsList(this.name);
  }

  getListenerConsumerStatsList(eventName: string): ConsumerStats[] {
    return this.client.channelGetListenerConsumerStatsList(this.name, eventName);
  }

  getAllListenersConsumerStatsList(): ConsumerStats[] {
    return this.client.channelGetAllListenersConsumerStatsList(this.name);
  }

  getOutputBackpressure(): number {
    return this.client.channelGetOutputBackpressure(this.name);
  }

  getListenerBackpressure(eventName: string): number {
    return this.client.channelGetListenerBackpressure(this.name, eventName);
  }

  getAllListenersBackpressure(): number {
    return this.client.channelGetAllListenersBackpressure(this.name);
  }

  hasOutputConsumer(consumerId: number): boolean {
    return this.client.channelHasOutputConsumer(this.name, consumerId);
  }

  hasListenerConsumer(eventName: string, consumerId: number): boolean {
    return this.client.channelHasListenerConsumer(this.name, eventName, consumerId);
  }

  hasAnyListenerConsumer(consumerId: number): boolean {
    return this.client.channelHasAnyListenerConsumer(this.name, consumerId);
  }

  subscribe(options?: any): void {
    this.client.subscribe(this.name, options);
  }

  unsubscribe(): void {
    this.client.unsubscribe(this.name);
  }

  isSubscribed(includePending?: boolean): boolean {
    return this.client.isSubscribed(this.name, includePending);
  }

  transmitPublish(data: any): Promise<void> {
    return this.client.transmitPublish(this.name, data);
  }

  invokePublish(data: any): Promise<void> {
    return this.client.invokePublish(this.name, data);
  }
}
