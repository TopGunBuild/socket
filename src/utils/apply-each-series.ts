export type AsyncFunction<T = any> = (...args: any[]) => T | Promise<T>;
export type Awaited<T> = T extends PromiseLike<infer R> ? R : T;
export type Async<T> = Promise<Awaited<T>>;

async function asyncForEach(array, callback)
{
    for (let index = 0; index < array.length; index++)
    {
        await callback(array[index], index, array);
    }
}

export async function applyEachSeries<T extends AsyncFunction[]>(tasks: T, ...args: Parameters<T[number]>) :Async<Array<ReturnType<T[number]>>>
{
    let callback = typeof args[args.length - 1] === 'function' ? args.pop() : () =>
    {
    };
    let err = null;
    let results = [];

    await asyncForEach(tasks, async (task) =>
    {
        if (!err)
        {
            try
            {
                const result = await task(...args);
                results.push(result);
            } catch (e)
            {
                results.push(undefined);
                err = e;
            }
        }
    });

    callback(err, results);
    return results;
}
