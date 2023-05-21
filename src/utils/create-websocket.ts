import global from '../utils/window-or-global';

export function createWebSocket(uri: string, options?: any): WebSocket
{
    if (global && typeof global.WebSocket === 'function')
    {
        return new global.WebSocket(uri);
    }
    else
    {
        const WebSocket: any = require('ws');
        return new WebSocket(uri, [], options);
    }
}