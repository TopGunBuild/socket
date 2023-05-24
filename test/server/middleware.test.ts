import { create, TGClientSocket, TGSocketClientOptions } from '../../src/client';
import { listen, TGSocketServer, TGSocketServerOptions } from '../../src/server';
import { wait } from '../../src/utils/wait';
import * as localStorage from 'localStorage';
import { validSignedAuthTokenBob, WS_ENGINE } from './utils';
import { cleanupTasks } from '../cleanup-tasks';

// Add to the global scope like in browser.
global.localStorage = localStorage;
let portNumber      = 8308;

const clientOptions: TGSocketClientOptions = {
    hostname: '127.0.0.1',
    port    : portNumber
};
const serverOptions: TGSocketServerOptions = {
    authKey : 'testkey',
    wsEngine: WS_ENGINE
};

let server: TGSocketServer, client: TGClientSocket;

let middlewareFunction;
let middlewareWasExecuted = false;

// Launch server without middleware before start
beforeEach(async () =>
{
    portNumber++;
    server = listen(portNumber, {
        authKey : serverOptions.authKey,
        wsEngine: WS_ENGINE
    });
    await server.listener('ready').once();
});

// Shut down server afterwards
afterEach(async () =>
{
    await cleanupTasks(client, server);
});

describe('Middleware', () =>
{
    describe('MIDDLEWARE_AUTHENTICATE', () =>
    {
        it('Should not run authenticate middleware if JWT token does not exist', async () =>
        {
            middlewareFunction = async function (req)
            {
                middlewareWasExecuted = true;
            };
            server.addMiddleware(server.MIDDLEWARE_AUTHENTICATE, middlewareFunction);

            client = create({
                hostname: clientOptions.hostname,
                port    : portNumber
            });

            await client.listener('connect').once();
            expect(middlewareWasExecuted).not.toEqual(true);
        });

        it('Should run authenticate middleware if JWT token exists', async () =>
        {
            global.localStorage.setItem('asyngular.authToken', validSignedAuthTokenBob);

            middlewareFunction = async function (req)
            {
                middlewareWasExecuted = true;
            };
            server.addMiddleware(server.MIDDLEWARE_AUTHENTICATE, middlewareFunction);

            client = create({
                hostname: clientOptions.hostname,
                port    : portNumber
            });

            (async () =>
            {
                try
                {
                    await client.invoke('login', { username: 'bob' });
                }
                catch (err)
                {
                }
            })();

            await client.listener('authenticate').once();
            expect(middlewareWasExecuted).toEqual(true);
        });
    });

    describe('MIDDLEWARE_HANDSHAKE_AG', () =>
    {
        it('Should trigger correct events if MIDDLEWARE_HANDSHAKE_AG blocks with an error', async () =>
        {
            let middlewareWasExecuted = false;
            let serverWarnings        = [];
            let clientErrors          = [];
            let abortStatus;

            middlewareFunction = async function (req)
            {
                await wait(100);
                middlewareWasExecuted = true;
                let err               = new Error('SC handshake failed because the server was too lazy');
                err.name              = 'TooLazyHandshakeError';
                throw err;
            };
            server.addMiddleware(server.MIDDLEWARE_HANDSHAKE_AG, middlewareFunction);

            (async () =>
            {
                for await (let { warning } of server.listener('warning'))
                {
                    serverWarnings.push(warning);
                }
            })();

            client = create({
                hostname: clientOptions.hostname,
                port    : portNumber
            });

            (async () =>
            {
                for await (let { error } of client.listener('error'))
                {
                    clientErrors.push(error);
                }
            })();

            (async () =>
            {
                let event   = await client.listener('connectAbort').once();
                abortStatus = event.code;
            })();

            await wait(200);
            expect(middlewareWasExecuted).toEqual(true);
            expect(clientErrors[0]).not.toEqual(null);
            expect(clientErrors[0].name).toEqual('TooLazyHandshakeError');
            expect(clientErrors[1]).not.toEqual(null);
            expect(clientErrors[1].name).toEqual('SocketProtocolError');
            expect(serverWarnings[0]).not.toEqual(null);
            expect(serverWarnings[0].name).toEqual('TooLazyHandshakeError');
            expect(abortStatus).not.toEqual(null);
        });

        it('Should send back default 4008 status code if MIDDLEWARE_HANDSHAKE_AG blocks without providing a status code', async () =>
        {
            let middlewareWasExecuted = false;
            let abortStatus;
            let abortReason;

            middlewareFunction = async function (req)
            {
                await wait(100);
                middlewareWasExecuted = true;
                let err               = new Error('SC handshake failed because the server was too lazy');
                err.name              = 'TooLazyHandshakeError';
                throw err;
            };
            server.addMiddleware(server.MIDDLEWARE_HANDSHAKE_AG, middlewareFunction);

            client = create({
                hostname: clientOptions.hostname,
                port    : portNumber
            });

            (async () =>
            {
                let event   = await client.listener('connectAbort').once();
                abortStatus = event.code;
                abortReason = event.reason;
            })();

            await wait(200);
            expect(middlewareWasExecuted).toEqual(true);
            expect(abortStatus).toEqual(4008);
            expect(abortReason).toEqual(
                'TooLazyHandshakeError: SC handshake failed because the server was too lazy'
            );
        });

        it('Should send back custom status code if MIDDLEWARE_HANDSHAKE_AG blocks by providing a status code', async () =>
        {
            let middlewareWasExecuted = false;
            let abortStatus;
            let abortReason;

            middlewareFunction = async function (req)
            {
                await wait(100);
                middlewareWasExecuted = true;
                let err               = new Error('SC handshake failed because of invalid query auth parameters');
                err.name              = 'InvalidAuthQueryHandshakeError';
                // Set custom 4501 status code as a property of the error.
                // We will treat this code as a fatal authentication failure on the front end.
                // A status code of 4500 or higher means that the client shouldn't try to reconnect.
                err['statusCode'] = 4501;
                throw err;
            };
            server.addMiddleware(server.MIDDLEWARE_HANDSHAKE_AG, middlewareFunction);

            client = create({
                hostname: clientOptions.hostname,
                port    : portNumber
            });

            (async () =>
            {
                let event   = await client.listener('connectAbort').once();
                abortStatus = event.code;
                abortReason = event.reason;
            })();

            await wait(200);
            expect(middlewareWasExecuted).toEqual(true);
            expect(abortStatus).toEqual(4501);
            expect(abortReason).toEqual(
                'InvalidAuthQueryHandshakeError: SC handshake failed because of invalid query auth parameters'
            );
        });

        it('Should connect with a delay if next() is called after a timeout inside the middleware function', async () =>
        {
            let createConnectionTime = null;
            let connectEventTime     = null;
            let abortStatus;
            let abortReason;

            middlewareFunction = async req => await wait(500);
            server.addMiddleware(server.MIDDLEWARE_HANDSHAKE_AG, middlewareFunction);

            createConnectionTime = Date.now();
            client               = create({
                hostname: clientOptions.hostname,
                port    : portNumber
            });

            (async () =>
            {
                let event   = await client.listener('connectAbort').once();
                abortStatus = event.code;
                abortReason = event.reason;
            })();

            await client.listener('connect').once();
            connectEventTime = Date.now();
            expect(connectEventTime - createConnectionTime > 400).toEqual(true);
        });
    });
});
