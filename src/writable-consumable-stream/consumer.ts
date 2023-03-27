import { ConsumableStreamConsumer } from '../consumable-stream';
import { ConsumerStats } from './consumer-stats';
import { WritableConsumableStream } from './index';

export class Consumer<T> implements ConsumableStreamConsumer<T>
{
    private readonly id: number;
    private readonly timeout: any;
    private _backpressure: number;
    private stream: WritableConsumableStream<T>;
    currentNode: any;
    private isAlive: boolean;
    private _timeoutId: undefined;
    private _resolve: any;
    private _killPacket: {value: any; done: boolean};

    /**
     * Constructor
     */
    constructor(stream, id, startNode, timeout)
    {
        this.id            = id;
        this._backpressure = 0;
        this.stream        = stream;
        this.currentNode   = startNode;
        this.timeout       = timeout;
        this.isAlive       = true;
        this.stream.setConsumer(this.id, this);
    }

    // -----------------------------------------------------------------------------------------------------
    // @ Public methods
    // -----------------------------------------------------------------------------------------------------

    getStats(): ConsumerStats
    {
        let stats: any = {
            id          : this.id,
            backpressure: this._backpressure
        };
        if (this.timeout != null)
        {
            stats.timeout = this.timeout;
        }
        return stats;
    }

    applyBackpressure(packet)
    {
        this._backpressure++;
    }

    releaseBackpressure(packet)
    {
        this._backpressure--;
    }

    getBackpressure()
    {
        return this._backpressure;
    }

    write(packet)
    {
        if (this._timeoutId !== undefined)
        {
            clearTimeout(this._timeoutId);
            delete this._timeoutId;
        }
        this.applyBackpressure(packet);
        if (this._resolve)
        {
            this._resolve();
            delete this._resolve;
        }
    }

    kill(value)
    {
        if (this._timeoutId !== undefined)
        {
            clearTimeout(this._timeoutId);
            delete this._timeoutId;
        }
        this._killPacket = { value, done: true };
        this._destroy();

        if (this._resolve)
        {
            this._resolve();
            delete this._resolve;
        }
    }

    async next()
    {
        this.stream.setConsumer(this.id, this);

        while (true)
        {
            if (!this.currentNode.next)
            {
                try
                {
                    await this._waitForNextItem(this.timeout);
                }
                catch (error)
                {
                    this._destroy();
                    throw error;
                }
            }
            if (this._killPacket)
            {
                this._destroy();
                let killPacket = this._killPacket;
                delete this._killPacket;

                return killPacket;
            }

            this.currentNode = this.currentNode.next;
            this.releaseBackpressure(this.currentNode.data);

            if (this.currentNode.consumerId && this.currentNode.consumerId !== this.id)
            {
                continue;
            }

            if (this.currentNode.data.done)
            {
                this._destroy();
            }

            return this.currentNode.data;
        }
    }

    return()
    {
        delete this.currentNode;
        this._destroy();
        return {};
    }

    // -----------------------------------------------------------------------------------------------------
    // @ Private methods
    // -----------------------------------------------------------------------------------------------------

    private _resetBackpressure()
    {
        this._backpressure = 0;
    }

    private _destroy()
    {
        this.isAlive = false;
        this._resetBackpressure();
        this.stream.removeConsumer(this.id);
    }

    private async _waitForNextItem(timeout)
    {
        return new Promise((resolve, reject) =>
        {
            this._resolve = resolve;
            let timeoutId;
            if (timeout !== undefined)
            {
                // Create the error object in the outer scope in order
                // to get the full stack trace.
                let error = new Error('Stream consumer iteration timed out');
                (async () =>
                {
                    let delay = wait(timeout);
                    timeoutId = delay.timeoutId;
                    await delay.promise;
                    error.name = 'TimeoutError';
                    delete this._resolve;
                    reject(error);
                })();
            }
            this._timeoutId = timeoutId;
        });
    }

    [Symbol.asyncIterator]()
    {
        return this;
    }
}

function wait(timeout): { timeoutId: any, promise: Promise<any> }
{
    let timeoutId;
    let promise = new Promise((resolve) =>
    {
        timeoutId = setTimeout(resolve, timeout);
    });
    return { timeoutId, promise };
}
