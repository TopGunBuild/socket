import { AsyncStreamEmitter } from '../async-stream-emitter';
import { SimpleExchange } from './simple-exchange';
import { CodecEngine } from '../socket-server/types';

export class AGSimpleBroker extends AsyncStreamEmitter<any>
{
    isReady: boolean;
    private _codec: CodecEngine;
    private readonly _exchangeClient: SimpleExchange;
    private readonly _clientSubscribers: {[key: string]: any};
    private readonly _clientSubscribersCounter: {[key: string]: any};

    /**
     * Constructor
     */
    constructor()
    {
        super();
        this.isReady                   = false;
        this._codec                    = null;
        this._exchangeClient           = new SimpleExchange(this);
        this._clientSubscribers        = {};
        this._clientSubscribersCounter = {};

        setTimeout(() =>
        {
            this.isReady = true;
            this.emit('ready', {});
        }, 0);
    }

    // -----------------------------------------------------------------------------------------------------
    // @ Public methods
    // -----------------------------------------------------------------------------------------------------

    exchange(): SimpleExchange
    {
        return this._exchangeClient;
    }

    async subscribeClient(client: {id: string}, channelName: string): Promise<void>
    {
        if (!this._clientSubscribers[channelName])
        {
            this._clientSubscribers[channelName]        = {};
            this._clientSubscribersCounter[channelName] = 0;
            this.emit('subscribe', {
                channel: channelName
            });
        }
        if (!this._clientSubscribers[channelName][client.id])
        {
            this._clientSubscribersCounter[channelName]++;
        }
        this._clientSubscribers[channelName][client.id] = client;
    }

    async subscribeSocket(client: {id: string}, channelName: string): Promise<void>
    {
        return this.subscribeClient(client, channelName);
    }

    async unsubscribeClient(client: {id: string}, channelName: string): Promise<void>
    {
        if (this._clientSubscribers[channelName])
        {
            if (this._clientSubscribers[channelName][client.id])
            {
                this._clientSubscribersCounter[channelName]--;
                delete this._clientSubscribers[channelName][client.id];

                if (this._clientSubscribersCounter[channelName] <= 0)
                {
                    delete this._clientSubscribers[channelName];
                    delete this._clientSubscribersCounter[channelName];
                    this.emit('unsubscribe', {
                        channel: channelName
                    });
                }
            }
        }
    }

    async unsubscribeSocket(client: {id: string}, channelName: string): Promise<void>
    {
        return this.unsubscribeClient(client, channelName);
    }

    subscriptions(): string[]
    {
        return Object.keys(this._clientSubscribers);
    }

    isSubscribed(channelName: string): boolean
    {
        return !!this._clientSubscribers[channelName];
    }

    setCodecEngine(codec: CodecEngine): void
    {
        this._codec = codec;
    }

    /**
     * In this implementation of the broker engine, both invokePublish and transmitPublish
     * methods are the same. In alternative implementations, they could be different.
     */
    invokePublish(channelName: string, data: any, suppressEvent?: boolean): Promise<void>
    {
        return this.transmitPublish(channelName, data, suppressEvent);
    }

    async transmitPublish(channelName: string, data: any, suppressEvent?: boolean): Promise<void>
    {
        let packet          = {
            channel: channelName,
            data
        };
        let transmitOptions: any = {};

        if (this._codec)
        {
            // Optimization
            try
            {
                transmitOptions.stringifiedData = this._codec.encode({
                    event: '#publish',
                    data : packet
                });
            }
            catch (error)
            {
                this.emit('error', { error });
                return;
            }
        }

        let subscriberClients = this._clientSubscribers[channelName] || {};

        Object.keys(subscriberClients).forEach((i) =>
        {
            subscriberClients[i].transmit('#publish', packet, transmitOptions);
        });

        if (!suppressEvent)
        {
            this.emit('publish', packet);
        }
    }
}
