import { create, TGClientSocket, TGSocketClientOptions } from '../../src/client';
import { wait } from '../../src/utils/wait';
import { listen, TGSocketServer, TGSocketServerOptions } from '../../src/server';
import { cleanupTasks } from '../cleanup-tasks';

let client: TGClientSocket,
    server: TGSocketServer,
    clientOptions: TGSocketClientOptions,
    serverOptions: TGSocketServerOptions;

const PORT_NUMBER = 7309;

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

describe('Ping/pong', () =>
{
    it('Should disconnect if ping is not received before timeout', async () =>
    {
        clientOptions.connectTimeout = 500;
        client                       = create(clientOptions);

        expect(client.pingTimeout).toEqual(500);

        (async () =>
        {
            for await (let event of client.listener('connect'))
            {
                expect(client.transport.pingTimeout).toEqual(server.options.pingTimeout);
                // Hack to make the client ping independent from the server ping.
                client.transport.pingTimeout = 500;
                client.transport._resetPingTimeout();
            }
        })();

        let disconnectCode = null;
        let clientError    = null;

        (async () =>
        {
            for await (let { error } of client.listener('error'))
            {
                clientError = error;
            }
        })();

        (async () =>
        {
            for await (let event of client.listener('disconnect'))
            {
                disconnectCode = event.code;
            }
        })();

        await wait(1000);

        expect(disconnectCode).toEqual(4000);
        expect(clientError).not.toEqual(null);
        expect(clientError.name).toEqual('SocketProtocolError');
    });

    it(
        'Should not disconnect if ping is not received before timeout when pingTimeoutDisabled is true',
        async () =>
        {
            clientOptions.connectTimeout      = 500;
            clientOptions.pingTimeoutDisabled = true;
            client                            = create(clientOptions);

            expect(client.pingTimeout).toEqual(500);

            let clientError = null;
            (async () =>
            {
                for await (let { error } of client.listener('error'))
                {
                    clientError = error;
                }
            })();

            await wait(1000);
            expect(clientError).toEqual(null);
        }
    );
});