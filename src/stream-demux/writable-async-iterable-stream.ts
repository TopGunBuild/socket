import { AsyncIterableStream } from './async-iterable-stream';

export class WritableAsyncIterableStream<T> extends AsyncIterableStream<T>
{
    private _nextConsumerId: number;
    private _consumers: {[key: string]: any};
    private _linkedListTailNode: any;

    /**
     * Constructor
     */
    constructor()
    {
        super();
        this._nextConsumerId     = 1;
        this._consumers          = {};
        this._linkedListTailNode = { next: null };
    }

    // -----------------------------------------------------------------------------------------------------
    // @ Public methods
    // -----------------------------------------------------------------------------------------------------

    write(value: T): void
    {
        this._write(value, false);
    }

    close(): void
    {
        this._write(undefined, true);
    }

    async _waitForNextDataNode(timeout?: number): Promise< void>
    {
        return new Promise((resolve, reject) =>
        {
            let timeoutId;
            const consumerId = this._nextConsumerId++;
            if (timeout !== undefined)
            {
                // Create the error object in the outer scope in order
                // to get the full stack trace.
                const error = new Error('Stream consumer iteration timed out');
                (async () =>
                {
                    const delay = wait(timeout);
                    timeoutId = delay.timeoutId;
                    await delay.promise;
                    error.name = 'TimeoutError';
                    delete this._consumers[consumerId];
                    reject(error);
                })();
            }
            this._consumers[consumerId] = {
                resolve,
                timeoutId
            };
        });
    }

    createAsyncIterator(timeout?: number): AsyncIterator<T>
    {
        let currentNode = this._linkedListTailNode;
        return {
            next: async () =>
            {
                if (!currentNode.next)
                {
                    await this._waitForNextDataNode(timeout);
                }
                currentNode = currentNode.next;
                return currentNode.data;
            }
        };
    }

    // -----------------------------------------------------------------------------------------------------
    // @ Private methods
    // -----------------------------------------------------------------------------------------------------

    private _write(value: T, done?: boolean): void
    {
        const dataNode                  = {
            data: { value, done },
            next: null
        };
        this._linkedListTailNode.next = dataNode;
        this._linkedListTailNode      = dataNode;
        Object.values(this._consumers).forEach((consumer) =>
        {
            if (consumer.timeoutId !== undefined)
            {
                clearTimeout(consumer.timeoutId);
            }
            consumer.resolve();
        });
        this._consumers      = {};
        this._nextConsumerId = 1;
    }
}

function wait(timeout: number = 0)
{
    let timeoutId;
    const promise = new Promise((resolve) =>
    {
        timeoutId = setTimeout(resolve, timeout);
    });
    return { timeoutId, promise };
}