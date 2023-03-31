import { ClientOptions } from './types';
import { create as factoryCreate } from './factory';
import { TGClientSocket } from './clientsocket';

export * from './auth';
export * from './clientsocket';
export * from './transport';
export * from './types';
export * from './ws-browser';

const version = '1.0.0';


export function create(options: ClientOptions): TGClientSocket
{
    return factoryCreate({ ...options, version });
}

export { version };
