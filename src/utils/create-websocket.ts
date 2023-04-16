import ws from 'ws';
import { getGlobal } from './global';
import { isFunction } from './is-function';

export function createWebSocket(uri: string, options: any): WebSocket
{
    const global: any = getGlobal();

    return global && isFunction(global.WebSocket)
        ? new global.WebSocket(uri)
        : new ws(uri, [], options) as unknown as WebSocket;
}
