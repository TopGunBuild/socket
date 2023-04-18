import { isDate } from './is-date';
import { isObject } from './is-object';

export function cloneDeep(value: any): any
{
    if (isDate(value))
    {
        return new Date(value.getTime());
    }
    if (Array.isArray(value))
    {
        return [...value].map(_value => cloneDeep(_value));
    }

    if (value instanceof Map || value instanceof Set)
    {
        return value;
    }

    if (isObject(value))
    {
        const result: {[key: string]: any} = {};

        for (const key of Object.keys(value))
        {
            result[key] = cloneDeep(value[key]);
        }
        return result;
    }
    return value;
}
