declare let WorkerGlobalScope: any;

export function getGlobal(): any
{
    if (typeof WorkerGlobalScope !== 'undefined')
    {
        return self;
    }
    else
    {
        return (
            (typeof window !== 'undefined' && window) ||
            (function ()
            {
                return (this || {});
            })()
        );
    }
}
