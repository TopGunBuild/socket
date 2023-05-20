/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-empty-function */
export abstract class AsyncIterableStream<T> implements AsyncIterator<T>, AsyncIterable<T>
{
    next(timeout?: number): Promise<IteratorResult<T>>
    {
        return this.createAsyncIterator(timeout).next();
    }

    async once(timeout?: number): Promise<T>
    {
        const result = await this.next(timeout);
        if (result.done)
        {
            // If stream was ended, this function should never resolve.
            await new Promise(() =>
            {
            });
        }
        return result.value;
    }

    createAsyncIterator(timeout?: number): AsyncIterator<T>
    {
        throw new TypeError('Method must be overriden by subclass');
    }

    createAsyncIterable(timeout?: number): AsyncIterable<T>
    {
        return {
            [Symbol.asyncIterator]: () =>
            {
                return this.createAsyncIterator(timeout);
            }
        }
    }

    [Symbol.asyncIterator](): AsyncIterator<T>
    {
        return this.createAsyncIterator();
    }
}

// export interface AsyncIterator<T>
// {
//     next(): Promise<IteratorResult<T>>;
//
//     return(): void;
// }
