import { AsyncIterableStream } from 'topgun-async-stream-emitter';
import { IClientSocket } from '../client/types';
import { ChannelState, SCChannelOptions } from './types';

export class TGChannel<T> extends AsyncIterableStream<T>
{
    static PENDING: ChannelState      = 'pending';
    static SUBSCRIBED: ChannelState   = 'subscribed';
    static UNSUBSCRIBED: ChannelState = 'unsubscribed';

    readonly PENDING: ChannelState;
    readonly SUBSCRIBED: ChannelState;
    readonly UNSUBSCRIBED: ChannelState;

    name: string;
    client: IClientSocket;
    _pendingSubscriptionCid: number;

    private _eventDemux: any;
    private _dataStream: any;

    /**
     * Constructor
     */
    constructor(name: string, client: IClientSocket, eventDemux, dataStream)
    {
        super();
        this.PENDING      = TGChannel.PENDING;
        this.SUBSCRIBED   = TGChannel.SUBSCRIBED;
        this.UNSUBSCRIBED = TGChannel.UNSUBSCRIBED;

        this.name   = name;
        this.client = client;

        this._eventDemux = eventDemux;
        this._dataStream = dataStream;
    }

    // -----------------------------------------------------------------------------------------------------
    // @ Accessors
    // -----------------------------------------------------------------------------------------------------

    get state(): ChannelState
    {
        return this.client.getChannelState(this.name);
    }

    set state(value: ChannelState)
    {
        throw new Error('Cannot directly set channel state');
    }

    get options(): SCChannelOptions
    {
        return this.client.getChannelOptions(this.name);
    }

    set options(value: SCChannelOptions)
    {
        throw new Error('Cannot directly set channel options');
    }

    // -----------------------------------------------------------------------------------------------------
    // @ Public methods
    // -----------------------------------------------------------------------------------------------------

    createAsyncIterator(timeout?: number): AsyncIterator<T>
    {
        return this._dataStream.createAsyncIterator(timeout);
    }

    listener(eventName: string)
    {
        return this._eventDemux.stream(`${this.name}/${eventName}`);
    }

    closeListener(eventName: string): void
    {
        this._eventDemux.close(`${this.name}/${eventName}`);
    }

    closeAllListeners(): void
    {
        this._eventDemux.closeAll();
    }

    close(): void
    {
        this.client.closeChannel(this.name);
    }

    subscribe(options: SCChannelOptions): void
    {
        this.client.subscribe(this.name, options);
    }

    unsubscribe(): void
    {
        this.client.unsubscribe(this.name);
    }

    isSubscribed(includePending?: boolean): boolean
    {
        return this.client.isSubscribed(this.name, includePending);
    }

    publish(data)
    {
        return this.client.publish(this.name, data);
    }
}