import { listen, TGSocketServer, TGSocketServerOptions } from '../../src/server';
import { create, TGSocketClientOptions, TGClientSocket } from '../../src/client';
import { wait } from '../../src/utils/wait';
import { cleanupTasks } from '../cleanup-tasks';

const WS_ENGINE = 'ws';
let portNumber  = 1410;

const clientOptions: TGSocketClientOptions = {
    hostname: '127.0.0.1',
    port    : portNumber
};
const serverOptions: TGSocketServerOptions = {
    authKey : 'testkey',
    wsEngine: WS_ENGINE
};

let server: TGSocketServer, client: TGClientSocket;

describe('Socket Ping/pong', () =>
{
    describe('When when pingTimeoutDisabled is not set', () =>
    {
        // Launch server with ping options before start
        beforeEach(async () =>
        {
            portNumber++;
            // Intentionally make pingInterval higher than pingTimeout, that
            // way the client will never receive a ping or send back a pong.
            server = listen(portNumber, {
                authKey     : serverOptions.authKey,
                wsEngine    : WS_ENGINE,
                pingInterval: 2000,
                pingTimeout : 500
            });

            await server.listener('ready').once();
        });

        // Shut down server afterwards
        afterEach(async () =>
        {
            await cleanupTasks(client, server);
        });

        it('Should disconnect socket if server does not receive a pong from client before timeout', async () =>
        {
            client = create({
                hostname: clientOptions.hostname,
                port    : portNumber
            });

            let serverWarning = null;
            (async () =>
            {
                for await (let { warning } of server.listener('warning'))
                {
                    serverWarning = warning;
                }
            })();

            let serverDisconnectionCode = null;
            (async () =>
            {
                for await (let event of server.listener('disconnection'))
                {
                    serverDisconnectionCode = event.code;
                }
            })();

            let clientError = null;
            (async () =>
            {
                for await (let { error } of client.listener('error'))
                {
                    clientError = error;
                }
            })();

            let clientDisconnectCode = null;
            (async () =>
            {
                for await (let event of client.listener('disconnect'))
                {
                    clientDisconnectCode = event.code;
                }
            })();

            await wait(1000);
            expect(clientError).not.toEqual(null);
            expect(clientError.name).toEqual('SocketProtocolError');
            expect(clientDisconnectCode).toEqual(4001);

            expect(serverWarning).not.toEqual(null);
            expect(serverWarning.name).toEqual('SocketProtocolError');
            expect(serverDisconnectionCode).toEqual(4001);

            await new Promise<void>(resolve => setTimeout(() => resolve(), 2000));
        });
    });

    describe('When when pingTimeoutDisabled is true', () =>
    {
        // Launch server with ping options before start
        beforeEach(async () =>
        {
            portNumber++;
            // Intentionally make pingInterval higher than pingTimeout, that
            // way the client will never receive a ping or send back a pong.
            server = listen(portNumber, {
                authKey            : serverOptions.authKey,
                wsEngine           : WS_ENGINE,
                pingInterval       : 2000,
                pingTimeout        : 500,
                pingTimeoutDisabled: true
            });

            await server.listener('ready').once();
        });

        // Shut down server afterwards
        afterEach(async () =>
        {
            await cleanupTasks(client, server);
        });

        it('Should not disconnect socket if server does not receive a pong from client before timeout', async () =>
        {
            client = create({
                hostname           : clientOptions.hostname,
                port               : portNumber,
                pingTimeoutDisabled: true
            });

            let serverWarning = null;
            (async () =>
            {
                for await (let { warning } of server.listener('warning'))
                {
                    serverWarning = warning;
                }
            })();

            let serverDisconnectionCode = null;
            (async () =>
            {
                for await (let event of server.listener('disconnection'))
                {
                    serverDisconnectionCode = event.code;
                }
            })();

            let clientError = null;
            (async () =>
            {
                for await (let { error } of client.listener('error'))
                {
                    clientError = error;
                }
            })();

            let clientDisconnectCode = null;
            (async () =>
            {
                for await (let event of client.listener('disconnect'))
                {
                    clientDisconnectCode = event.code;
                }
            })();

            await wait(1000);
            expect(clientError).toEqual(null);
            expect(clientDisconnectCode).toEqual(null);

            expect(serverWarning).toEqual(null);
            expect(serverDisconnectionCode).toEqual(null);
        });
    });
});