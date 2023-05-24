import { listen, TGSocketServer, TGSocketServerOptions } from '../../src/server';
import { create, TGClientSocket, TGSocketClientOptions } from '../../src/client';
import { wait } from '../../src/utils/wait';
import { connectionHandler, resolveAfterTimeout, WS_ENGINE } from './utils';
import { cleanupTasks } from '../cleanup-tasks';

let portNumber                             = 8208;
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

describe('Socket disconnection', () =>
{
    it('Server-side socket disconnect event should not trigger if the socket did not complete the handshake; instead, it should trigger connectAbort', async () =>
    {
        portNumber++;
        server = listen(portNumber, {
            authKey : serverOptions.authKey,
            wsEngine: WS_ENGINE
        });
        server.setAuthEngine({
            verifyToken: function (signedAuthToken, verificationKey, verificationOptions)
            {
                return resolveAfterTimeout(500, {});
            }
        });

        let connectionOnServer = false;

        (async () =>
        {
            for await (let { socket } of server.listener('connection'))
            {
                connectionOnServer = true;
                connectionHandler(socket, {}, server);
            }
        })();

        await server.listener('ready').once();

        client = create({
            hostname: clientOptions.hostname,
            port    : portNumber
        });

        let socketDisconnected              = false;
        let socketDisconnectedBeforeConnect = false;
        let clientSocketAborted             = false;

        (async () =>
        {
            let { socket } = await server.listener('handshake').once();
            expect(server.pendingClientsCount).toEqual(1);
            expect(server.pendingClients[socket.id]).not.toEqual(null);

            (async () =>
            {
                await socket.listener('disconnect').once();
                if (!connectionOnServer)
                {
                    socketDisconnectedBeforeConnect = true;
                }
                socketDisconnected = true;
            })();

            (async () =>
            {
                let event           = await socket.listener('connectAbort').once();
                clientSocketAborted = true;
                expect(event.code).toEqual(4444);
                expect(event.reason).toEqual('Disconnect before handshake');
            })();
        })();

        let serverDisconnected  = false;
        let serverSocketAborted = false;

        (async () =>
        {
            await server.listener('disconnection').once();
            serverDisconnected = true;
        })();

        (async () =>
        {
            await server.listener('connectionAbort').once();
            serverSocketAborted = true;
        })();

        await wait(100);
        client.disconnect(4444, 'Disconnect before handshake');

        await wait(1000);
        expect(socketDisconnected).toEqual(false);
        expect(socketDisconnectedBeforeConnect).toEqual(false);
        expect(clientSocketAborted).toEqual(true);
        expect(serverSocketAborted).toEqual(true);
        expect(serverDisconnected).toEqual(false);
    });

    it('Server-side socket disconnect event should trigger if the socket completed the handshake (not connectAbort)', async () =>
    {
        portNumber++;
        server = listen(portNumber, {
            authKey : serverOptions.authKey,
            wsEngine: WS_ENGINE
        });
        server.setAuthEngine({
            verifyToken: function (signedAuthToken, verificationKey, verificationOptions)
            {
                return resolveAfterTimeout(10, {});
            }
        });

        let connectionOnServer = false;

        (async () =>
        {
            for await (let { socket } of server.listener('connection'))
            {
                connectionOnServer = true;
                connectionHandler(socket, {}, server);
            }
        })();

        await server.listener('ready').once();

        client = create({
            hostname: clientOptions.hostname,
            port    : portNumber
        });

        let socketDisconnected              = false;
        let socketDisconnectedBeforeConnect = false;
        let clientSocketAborted             = false;

        (async () =>
        {
            let { socket } = await server.listener('handshake').once();
            expect(server.pendingClientsCount).toEqual(1);
            expect(server.pendingClients[socket.id]).not.toEqual(null);

            (async () =>
            {
                let event = await socket.listener('disconnect').once();
                if (!connectionOnServer)
                {
                    socketDisconnectedBeforeConnect = true;
                }
                socketDisconnected = true;
                expect(event.code).toEqual(4445);
                expect(event.reason).toEqual('Disconnect after handshake');
            })();

            (async () =>
            {
                let event           = await socket.listener('connectAbort').once();
                clientSocketAborted = true;
            })();
        })();

        let serverDisconnected  = false;
        let serverSocketAborted = false;

        (async () =>
        {
            await server.listener('disconnection').once();
            serverDisconnected = true;
        })();

        (async () =>
        {
            await server.listener('connectionAbort').once();
            serverSocketAborted = true;
        })();

        await wait(200);
        client.disconnect(4445, 'Disconnect after handshake');

        await wait(1000);

        expect(socketDisconnectedBeforeConnect).toEqual(false);
        expect(socketDisconnected).toEqual(true);
        expect(clientSocketAborted).toEqual(false);
        expect(serverDisconnected).toEqual(true);
        expect(serverSocketAborted).toEqual(false);
    });

    it('The close event should trigger when the socket loses the connection before the handshake', async () =>
    {
        let connectionOnServer = false;
        portNumber++;
        server = listen(portNumber, {
            authKey : serverOptions.authKey,
            wsEngine: WS_ENGINE
        });
        server.setAuthEngine({
            verifyToken: function (signedAuthToken, verificationKey, verificationOptions)
            {
                return resolveAfterTimeout(500, {});
            }
        });

        (async () =>
        {
            for await (let { socket } of server.listener('connection'))
            {
                connectionOnServer = true;
                connectionHandler(socket, {}, server);
            }
        })();

        await server.listener('ready').once();

        client = create({
            hostname: clientOptions.hostname,
            port    : portNumber
        });

        let serverSocketClosed  = false;
        let serverSocketAborted = false;
        let serverClosure       = false;

        (async () =>
        {
            for await (let { socket } of server.listener('handshake'))
            {
                let event          = await socket.listener('close').once();
                serverSocketClosed = true;
                expect(event.code).toEqual(4444);
                expect(event.reason).toEqual('Disconnect before handshake');
            }
        })();

        (async () =>
        {
            for await (let event of server.listener('connectionAbort'))
            {
                serverSocketAborted = true;
            }
        })();

        (async () =>
        {
            for await (let event of server.listener('closure'))
            {
                expect(event.socket.state).toEqual(event.socket.CLOSED);
                serverClosure = true;
            }
        })();

        await wait(100);
        client.disconnect(4444, 'Disconnect before handshake');

        await wait(1000);
        expect(serverSocketClosed).toEqual(true);
        expect(serverSocketAborted).toEqual(true);
        expect(serverClosure).toEqual(true);
    });

    it('The close event should trigger when the socket loses the connection after the handshake', async () =>
    {
        let connectionOnServer = false;
        portNumber++;
        server = listen(portNumber, {
            authKey : serverOptions.authKey,
            wsEngine: WS_ENGINE
        });
        server.setAuthEngine({
            verifyToken: function (signedAuthToken, verificationKey, verificationOptions)
            {
                return resolveAfterTimeout(0, {});
            }
        });

        (async () =>
        {
            for await (let { socket } of server.listener('connection'))
            {
                connectionOnServer = true;
                connectionHandler(socket, {}, server);
            }
        })();

        await server.listener('ready').once();

        client = create({
            hostname: clientOptions.hostname,
            port    : portNumber
        });

        let serverSocketClosed       = false;
        let serverSocketDisconnected = false;
        let serverClosure            = false;

        (async () =>
        {
            for await (let { socket } of server.listener('handshake'))
            {
                let event          = await socket.listener('close').once();
                serverSocketClosed = true;
                expect(event.code).toEqual(4445);
                expect(event.reason).toEqual('Disconnect after handshake');
            }
        })();

        (async () =>
        {
            for await (let event of server.listener('disconnection'))
            {
                serverSocketDisconnected = true;
            }
        })();

        (async () =>
        {
            for await (let event of server.listener('closure'))
            {
                expect(event.socket.state).toEqual(event.socket.CLOSED);
                serverClosure = true;
            }
        })();

        await wait(100);
        client.disconnect(4445, 'Disconnect after handshake');

        await wait(1000);
        expect(serverSocketClosed).toEqual(true);
        expect(serverSocketDisconnected).toEqual(true);
        expect(serverClosure).toEqual(true);
    });
});
