import { create, TGClientSocket, TGSocketClientOptions } from '../../src/client';
import { listen, TGSocketServer, TGSocketServerOptions } from '../../src/server';
import { cleanupTasks } from '../cleanup-tasks';

let client: TGClientSocket,
    server: TGSocketServer,
    clientOptions: TGSocketClientOptions,
    serverOptions: TGSocketServerOptions;

const PORT_NUMBER = 610;

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

describe('Reconnecting socket', () =>
{
    it('Should disconnect socket with code 1000 and reconnect', async () =>
    {
        client = create(clientOptions);

        await client.listener('connect').once();

        let disconnectCode;
        let disconnectReason;

        (async () =>
        {
            for await (let event of client.listener('disconnect'))
            {
                disconnectCode   = event.code;
                disconnectReason = event.reason;
            }
        })();

        client.reconnect();
        await client.listener('connect').once();

        expect(disconnectCode).toEqual(1000);
        expect(disconnectReason).toEqual(undefined);
    });

    it(
        'Should disconnect socket with custom code and data when socket.reconnect() is called with arguments',
        async () =>
        {
            client = create(clientOptions);

            await client.listener('connect').once();

            let disconnectCode;
            let disconnectReason;

            (async () =>
            {
                let event        = await client.listener('disconnect').once();
                disconnectCode   = event.code;
                disconnectReason = event.reason;
            })();

            client.reconnect(1000, 'About to reconnect');
            await client.listener('connect').once();

            expect(disconnectCode).toEqual(1000);
            expect(disconnectReason).toEqual('About to reconnect');
        }
    );
});