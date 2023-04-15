export function isObject(value: any): boolean 
{
    return (
        !!value &&
        typeof value === 'object' &&
        Object.prototype.toString.call(value) !== '[object Array]'
    );
}
