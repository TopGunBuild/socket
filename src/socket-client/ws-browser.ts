import { getGlobal } from '../utils/global';

const global = getGlobal();
const WebSocket = global?.WebSocket || global?.MozWebSocket;

/**
 * WebSocket constructor.
 *
 * The third `opts` options object gets ignored in web browsers, since it's
 * non-standard, and throws a TypeError if passed to the constructor.
 * See: https://github.com/einaros/ws/issues/227
 *
 * @param {String} uri
 * @param {Array} protocols (optional)
 * @api public
 */

function ws(uri: string, protocols?: string[]): WebSocket
{
    let instance;
    if (protocols)
    {
        instance = new WebSocket(uri, protocols);
    }
    else
    {
        instance = new WebSocket(uri);
    }
    return instance;
}

if (WebSocket)
{
    ws.prototype = WebSocket.prototype;
}

export { ws };
