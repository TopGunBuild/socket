import global from '../utils/window-or-global';
import { isFunction } from './is-function';

export function createWebSocket(uri: string, options?: any): WebSocket
{
    if (global && isFunction(global.WebSocket))
    {
        return new global.WebSocket(uri);
    }
    else
    {
        const WebSocket: any = require('ws');
        return new WebSocket(uri, [], options);
    }
}
