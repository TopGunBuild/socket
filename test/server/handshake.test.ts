import { listen, TGSocketServer, TGSocketServerOptions } from '../../src/server';
import { create, TGClientSocket, TGSocketClientOptions } from '../../src/client';
import { connectionHandler, WS_ENGINE } from './utils';
import { cleanupTasks } from '../cleanup-tasks';

let portNumber                             = 8258;
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
    await cleanupTasks(client, server);
});

describe('Socket handshake', () =>
{
    it('Exchange is attached to socket before the handshake event is triggered', async () =>
    {
        server = listen(portNumber, {
            authKey : serverOptions.authKey,
            wsEngine: WS_ENGINE
        });

        (async () =>
        {
            for await (let { socket } of server.listener('connection'))
            {
                connectionHandler(socket, {}, server);
            }
        })();

        await server.listener('ready').once();

        client = create({
            hostname: clientOptions.hostname,
            port    : portNumber
        });

        let { socket } = await server.listener('handshake').once();
        expect(socket.exchange).not.toEqual(null);
    });
});