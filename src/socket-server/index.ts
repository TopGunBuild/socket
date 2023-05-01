import { Server } from 'http';
import { TGServerSocketGateway } from './server';
import { TGServerSocketGatewayOptions } from './types';
import { isNode } from '../utils/is-node';

export * from './action';
export * from './server';
export * from './server-socket';
export * from './types';


type ListenFn = (...rest: any[]) => void;

/**
 * Captures upgrade requests for a http.Server.
 */
export function attach(server: Server, options?: TGServerSocketGatewayOptions)
{
    options            = options || {};
    options.httpServer = server;
    return new TGServerSocketGateway(options);
}

export function listen(
    port: number,
    options?: TGServerSocketGatewayOptions|ListenFn,
    fn?: ListenFn
): TGServerSocketGateway
{
    if (typeof options === 'function')
    {
        fn      = options;
        options = {};
    }

    if (isNode())
    {
        const http   = require('http');
        const server = http.createServer((req, res) =>
        {
            res.writeHead(501);
            res.end('Not Implemented');
        });

        options.httpServer = server;
        const gateway      = attach(server, options);
        server.listen(port, fn);

        return gateway;
    }
    else
    {
        return new TGServerSocketGateway(options);
    }
}
