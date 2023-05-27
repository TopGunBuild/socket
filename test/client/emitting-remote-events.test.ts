import { create, TGClientSocket, TGSocketClientOptions } from '../../src/client';
import { wait } from '../../src/utils/wait';
import { listen, TGSocketServer, TGSocketServerOptions } from '../../src/server';
import { cleanupTasks } from '../cleanup-tasks';
import { handleServerConnection } from './utils';

const PORT_NUMBER = 210;

let client: TGClientSocket,
    server: TGSocketServer,
    clientOptions: TGSocketClientOptions,
    serverOptions: TGSocketServerOptions;

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

    handleServerConnection(server);

    await server.listener('ready').once();
});

afterEach(async () =>
{
    await cleanupTasks(client, server);
});

describe('Emitting remote events', () =>
{
    it(
        'Should not throw error on socket if ackTimeout elapses before response to event is sent back',
        async () =>
        {
            client = create(clientOptions);

            let caughtError;
            let clientError;

            (async () =>
            {
                for await (let { error } of client.listener('error'))
                {
                    clientError = error;
                }
            })();

            let responseError;

            for await (let event of client.listener('connect'))
            {
                try
                {
                    await client.invoke('performTask', 123);
                }
                catch (err)
                {
                    responseError = err;
                }
                await wait(250);
                try
                {
                    client.disconnect();
                }
                catch (err)
                {
                    caughtError = err;
                }
                break;
            }

            expect(responseError).not.toEqual(null);
            expect(caughtError).toBeUndefined();
        }
    );
});