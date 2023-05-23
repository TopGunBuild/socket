import { listen, TGSocketServer, TGSocketServerOptions } from '../../src/server';
import { create, TGClientSocket, TGSocketClientOptions } from '../../src/client';
import { EventObject } from '../../src/types';
import { wait } from '../../src/utils/wait';
import { connectionHandler, destroyTestCase, WS_ENGINE } from '../utils';

let portNumber                             = 8108;
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

describe('Socket connection', () => {
    it('Server-side socket connect event and server connection event should trigger', async () => {
        portNumber++;
        server = listen(portNumber, {
            authKey: serverOptions.authKey,
            wsEngine: WS_ENGINE
        });

        let connectionEmitted = false;
        let connectionEvent;

        (async () => {
            for await (let event of server.listener('connection')) {
                connectionEvent = event;
                connectionHandler(event.socket, {}, server);
                connectionEmitted = true;
            }
        })();

        await server.listener('ready').once();

        client = create({
            hostname: clientOptions.hostname,
            port: portNumber
        });

        let connectEmitted = false;
        let connectStatus;
        let socketId;

        (async () => {
            for await (let {socket} of server.listener('handshake')) {
                (async () => {
                    for await (let serverSocketStatus of socket.listener('connect')) {
                        socketId = socket.id;
                        connectEmitted = true;
                        connectStatus = serverSocketStatus;
                        // This is to check that mutating the status on the server
                        // doesn't affect the status sent to the client.
                        serverSocketStatus.foo = 123;
                    }
                })();
            }
        })();

        let clientConnectEmitted = false;
        let clientConnectStatus: EventObject = null;

        (async () => {
            for await (let event of client.listener('connect')) {
                clientConnectEmitted = true;
                clientConnectStatus = event;
            }
        })();

        await wait(300);

        expect(connectEmitted).toEqual(true);
        expect(connectionEmitted).toEqual(true);
        expect(clientConnectEmitted).toEqual(true);

        expect(connectionEvent).not.toEqual(null);
        expect(connectionEvent.id).toEqual(socketId);
        expect(connectionEvent.pingTimeout).toEqual(server.pingTimeout);
        expect(connectionEvent.authError).toBeUndefined();
        expect(connectionEvent.isAuthenticated).toEqual(false);

        expect(connectStatus).not.toEqual(null);
        expect(connectStatus.id).toEqual(socketId);
        expect(connectStatus.pingTimeout).toEqual(server.pingTimeout);
        expect(connectStatus.authError).toBeUndefined();
        expect(connectStatus.isAuthenticated).toEqual(false);

        expect(clientConnectStatus).not.toEqual(null);
        expect(clientConnectStatus.id).toEqual(socketId);
        expect(clientConnectStatus.pingTimeout).toEqual(server.pingTimeout);
        expect(clientConnectStatus.authError).toBeUndefined();
        expect(clientConnectStatus.isAuthenticated).toEqual(false);
        expect(clientConnectStatus['foo']).toBeUndefined();
        // Client socket status should be a clone of server socket status; not
        // a reference to the same object.
        expect(clientConnectStatus['foo']).not.toEqual(connectStatus.foo);
    });
});