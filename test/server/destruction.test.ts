import { listen, TGSocketServer, TGSocketServerOptions } from '../../src/server';
import { wait } from '../../src/utils/wait';
import { create, TGClientSocket, TGSocketClientOptions } from '../../src/client';
import { destroyTestCase, WS_ENGINE } from '../utils';

let portNumber                             = 8158;
const clientOptions: TGSocketClientOptions = {
    hostname: '127.0.0.1',
    port    : portNumber
};
const serverOptions: TGSocketServerOptions = {
    authKey : 'testkey',
    wsEngine: WS_ENGINE
};
let server: TGSocketServer, client: TGClientSocket;

// Shut down server afterwards
afterEach(async () =>
{
    destroyTestCase(client, server);
});

describe('Socket destruction', () =>
{
    it('Server socket destroy should disconnect the socket', async () =>
    {
        portNumber++;
        server = listen(portNumber, {
            authKey : serverOptions.authKey,
            wsEngine: WS_ENGINE
        });

        (async () =>
        {
            for await (let { socket } of server.listener('connection'))
            {
                await wait(100);
                socket.disconnect(1000, 'Custom reason');
            }
        })();

        await server.listener('ready').once();

        client = create({
            hostname: clientOptions.hostname,
            port    : portNumber
        });

        let { code, reason } = await client.listener('disconnect').once();
        expect(code).toEqual(1000);
        expect(reason).toEqual('Custom reason');
        expect(server.clientsCount).toEqual(0);
        expect(server.pendingClientsCount).toEqual(0);
    });

    it('Server socket destroy should set the active property on the socket to false', async () =>
    {
        portNumber++;
        server = listen(portNumber, {
            authKey : serverOptions.authKey,
            wsEngine: WS_ENGINE
        });

        let serverSocket;

        (async () =>
        {
            for await (let { socket } of server.listener('connection'))
            {
                serverSocket = socket;
                expect(socket.state).toEqual('open');
                await wait(100);
                socket.disconnect();
            }
        })();

        await server.listener('ready').once();
        client = create({
            hostname: clientOptions.hostname,
            port    : portNumber
        });

        await client.listener('disconnect').once();
        expect(serverSocket.state).toEqual('closed');
    });
});
