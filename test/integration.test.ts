import { ClientOptions, create as createClient, TGClientSocket } from '../src/socket-client';
import { wait } from '../src/utils/wait';
import { create as createSocketClient } from 'socketcluster-client';
import { listen as scListen } from 'socketcluster-server';
import * as http from 'http'
import { attach, TGServerSocketGateway, TGServerSocketGatewayOptions } from '../src/socket-server';

const PORT_NUMBER = 8009;

let clientOptions: ClientOptions;
let serverOptions: TGServerSocketGatewayOptions;
let server: TGServerSocketGateway;
let client: TGClientSocket;

let allowedUsers = {
    bob  : true,
    kate : true,
    alice: true
};

let validSignedAuthTokenBob  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VybmFtZSI6ImJvYiIsImV4cCI6MzE2Mzc1ODk3ODIxNTQ4NywiaWF0IjoxNTAyNzQ3NzQ2fQ.GLf_jqi_qUSCRahxe2D2I9kD8iVIs0d4xTbiZMRiQq4';
let validSignedAuthTokenKate = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VybmFtZSI6ImthdGUiLCJleHAiOjMxNjM3NTg5NzgyMTU0ODcsImlhdCI6MTUwMjc0Nzc5NX0.Yfb63XvDt9Wk0wHSDJ3t7Qb1F0oUVUaM5_JKxIE2kyw';
let invalidSignedAuthToken   = 'fakebGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.fakec2VybmFtZSI6ImJvYiIsImlhdCI6MTUwMjYyNTIxMywiZXhwIjoxNTAyNzExNjEzfQ.fakemYcOOjM9bzmS4UYRvlWSk_lm3WGHvclmFjLbyOk';

const TOKEN_EXPIRY_IN_SECONDS = 60 * 60 * 24 * 366 * 5000;

const connectionHandler = socket =>
{
    async function handleLogin()
    {
        let rpc = await socket.procedure('login').once();
        if (allowedUsers[rpc.data.username])
        {
            rpc.data.exp = Math.round(Date.now() / 1000) + TOKEN_EXPIRY_IN_SECONDS;
            socket.setAuthToken(rpc.data);
            rpc.end();
        }
        else
        {
            let err  = new Error('Failed to login');
            err.name = 'FailedLoginError';
            rpc.error(err);
        }
    }

    handleLogin();

    async function handleSetAuthKey()
    {
        let rpc                = await socket.procedure('setAuthKey').once();
        server.signatureKey    = rpc.data;
        server.verificationKey = rpc.data;
        rpc.end();
    }

    handleSetAuthKey();

    async function handlePerformTask()
    {
        for await (let rpc of socket.procedure('performTask'))
        {
            setTimeout(function ()
            {
                rpc.end();
            }, 1000);
        }
    }

    handlePerformTask();
};

describe('Integration tests', () =>
{
    // Run the server before start
    beforeEach(async () =>
    {
        serverOptions = {
            authKey   : 'testkey',
            ackTimeout: 200
        };

        // const httpServer = http.createServer();
        // const tgServer   = attach(httpServer, serverOptions);

        server = scListen(PORT_NUMBER, serverOptions);

        async function handleServerConnection()
        {
            for await (let { socket } of server.listener('connection'))
            {
                connectionHandler(socket);
            }
        }

        handleServerConnection();

        clientOptions = {
            hostname  : '127.0.0.1',
            port      : PORT_NUMBER,
            ackTimeout: 200
        };

        // await tgServer.listener('ready').once();

        await server.listener('ready').once();
    });

    // Shut down server and clients afterwards
    afterEach(async () =>
    {
        let cleanupTasks = [];
        global.localStorage.removeItem('socketcluster.authToken');
        if (client)
        {
            if (client.state !== client.CLOSED)
            {
                cleanupTasks.push(
                    Promise.race([
                        client.listener('disconnect').once(),
                        client.listener('connectAbort').once()
                    ])
                );
                client.disconnect();
            }
            else
            {
                client.disconnect();
            }
        }
        cleanupTasks.push(
            (async () =>
            {
                server.httpServer.close();
                await server.close();
            })()
        );
        await Promise.all(cleanupTasks);
    });

    describe('Creation', () =>
    {
        it('Should automatically connect socket on creation by default', async () =>
        {
            clientOptions = {
                hostname: '127.0.0.1',
                port    : PORT_NUMBER
            };

            client = createClient(clientOptions);
            expect(client.state).toBe(client.CONNECTING);
        });

        it('Should not automatically connect socket if autoConnect is set to false', async () =>
        {
            clientOptions = {
                hostname   : '127.0.0.1',
                port       : PORT_NUMBER,
                autoConnect: false
            };

            client = createClient(clientOptions);
            expect(client.state).toBe(client.CLOSED);
        });
    });

    describe('Errors', () =>
    {
        it('Should be able to emit the error event locally on the socket', async () =>
        {
            client  = createClient(clientOptions);
            let err = null;

            (async () =>
            {
                for await (let { error } of client.listener('error'))
                {
                    err = error;
                }
            })();

            await wait(100);

            expect(err).not.toEqual(null);
            expect(err.name).toBe('SocketProtocolError');
        });
    });

    describe('Authentication', () =>
    {
        it('Should not send back error if JWT is not provided in handshake', async () =>
        {
            client    = createSocketClient(clientOptions);
            // client = createClient(clientOptions);
            let event = await client.listener('connect').once();
            console.log(event);
            expect(event.authError).toBeUndefined();
        });
    });
});