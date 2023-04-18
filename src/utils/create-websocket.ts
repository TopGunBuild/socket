import { getGlobal } from './global';
import { isFunction } from './is-function';

export function createWebSocket(uri: string, options?: any): WebSocket
{
    const global: any = getGlobal();

    if (global && isFunction(global.WebSocket))
    {
        return new global.WebSocket(uri);
    }

    throw Error(`WebSocket instance not found`);
}
