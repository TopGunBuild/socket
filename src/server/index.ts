import { Server } from 'http';
import { TGSocketServerOptions } from './types';
import { TGSocketServer } from './server';
import { isNode } from '../utils/is-node';

export * from './types';
export * from './server';
export * from './socket';

type ListenFn = (...rest: any[]) => void;

/**
 * Captures upgrade requests for a http.Server.
 */
export function attach(server: Server, options?: TGSocketServerOptions): TGSocketServer
{
    options            = options || {};
    options.httpServer = server;
    return new TGSocketServer(options);
}

export function listen(
    port: number,
    options?: TGSocketServerOptions|ListenFn,
    fn?: ListenFn
): TGSocketServer
{
    if (typeof options === 'function')
    {
        fn      = options;
        options = {};
    }

    if (isNode())
    {
        const http   = require('http');
        const httpServer = http.createServer();

        const gateway      = attach(httpServer, options);
        gateway.httpServer = httpServer;
        httpServer.listen(port, fn);

        return gateway;
    }
    else
    {
        return new TGSocketServer(options);
    }
}
