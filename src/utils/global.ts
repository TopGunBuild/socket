declare let WorkerGlobalScope;

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
                return this;
            })()
        );
    }
}
