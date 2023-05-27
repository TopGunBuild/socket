import { create, TGClientSocket, TGSocketClientOptions } from '../../src/client';
import { wait } from '../../src/utils/wait';
import { cleanupTasks } from '../cleanup-tasks';
import { listen, TGSocketServer, TGSocketServerOptions } from '../../src/server';

let client: TGClientSocket,
    server: TGSocketServer,
    clientOptions: TGSocketClientOptions,
    serverOptions: TGSocketServerOptions;

const PORT_NUMBER = 310;

beforeEach(async () =>
{
    serverOptions = {
        ackTimeout: 200
    };
    clientOptions = {
        hostname  : '127.0.0.1',
        port      : PORT_NUMBER,
        ackTimeout: 200
    };

    server = listen(PORT_NUMBER, serverOptions);

    await server.listener('ready').once();
});

afterEach(async () =>
{
    await cleanupTasks(client, server);
});

describe('Errors', () =>
{
    it(
        'Should be able to emit the error event locally on the socket',
        async () =>
        {
            client  = create(clientOptions);
            let err = null;

            (async () =>
            {
                for await (let { error } of client.listener('error'))
                {
                    err = error;
                }
            })();

            (async () =>
            {
                for await (let status of client.listener('connect'))
                {
                    let error  = new Error('Custom error');
                    error.name = 'CustomError';
                    client.emit('error', { error });
                }
            })();

            await wait(100);

            expect(err).not.toEqual(null);
            expect(err.name).toEqual('CustomError');
        }
    );
});