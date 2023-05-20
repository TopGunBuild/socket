export type MiddlewareReqType = (req: any) => Promise<any>;
export type MiddlewareCallback = (error?: any, result?: any) => void;

export async function applyEachSeries(middleware: MiddlewareReqType[], req: any, cb: MiddlewareCallback)
{
    for (let index = 0; index < middleware.length; index++)
    {
        try
        {
            const result = await middleware[index](req);
            cb(null, result);
        }
        catch (e)
        {
            cb(e);
        }
    }
}
