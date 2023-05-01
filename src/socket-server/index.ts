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
        const httpServer = http.createServer();

        const gateway      = attach(httpServer, options);
        gateway.httpServer = httpServer;
        httpServer.listen(port, fn);

        return gateway;
    }
    else
    {
        return new TGServerSocketGateway(options);
    }
}
