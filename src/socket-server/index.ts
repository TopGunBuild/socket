import { TGServerSocketGateway } from './server';
import { TGServerSocketGatewayOptions } from './types';

export * from './action';
export * from './server';
export * from './server-socket';
export * from './types';

/**
 * Captures upgrade requests for a http.Server.
 */
export function attach(server: any, options?: TGServerSocketGatewayOptions)
{
    options            = options || {};
    options.httpServer = server;
    return new TGServerSocketGateway(options);
}

type ListenFn = (...rest: any[]) => void;

export function listen(
    http: any,
    port: number,
    options?: TGServerSocketGatewayOptions | ListenFn,
    fn?: ListenFn
): TGServerSocketGateway
{
    if (typeof options === 'function')
    {
        fn      = options;
        options = {};
    }

    const server = http.createServer((req, res) =>
    {
        res.writeHead(501);
        res.end('Not Implemented');
    });

    const gateway        = attach(server, options);
    gateway.httpServer = server;
    server.listen(port, fn);

    return gateway;
}
