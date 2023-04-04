import { TGServerSocketGateway } from './server';
import { TGServerSocketGatewayOptions } from './types';
import { isObject } from '../utils/is-object';

export * from './action';
export * from './server-socket';
export * from './server';
export * from './types';

/**
 * Captures upgrade requests for a http.Server.
 */
export function attach(server, options?: TGServerSocketGatewayOptions)
{
    if (!isObject(options))
    {
        options = {};
    }
    options.httpServer = server;
    return new TGServerSocketGateway(options);
}