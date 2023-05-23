import { create, TGClientSocket, TGSocketClientOptions } from '../../src/client';
import { listen, TGSocketServer, TGSocketServerOptions } from '../../src/server';
import * as localStorage from 'localStorage';
import {
    connectionHandler, destroyTestCase, resolveAfterTimeout,
    TEN_DAYS_IN_SECONDS,
    validSignedAuthTokenAlice,
    validSignedAuthTokenBob,
    WS_ENGINE
} from '../utils';
import { wait } from '../../src/utils/wait';

// Add to the global scope like in browser.
global.localStorage = localStorage;
let portNumber      = 8008;
const allowedUsers  = {
    bob  : true,
    alice: true
};

let server: TGSocketServer,
    client: TGClientSocket,
    clientOptions: TGSocketClientOptions,
    serverOptions: TGSocketServerOptions;

// Run the server before start
beforeEach(async () =>
{
    serverOptions = {
        authKey : 'testkey',
        wsEngine: WS_ENGINE
    };
    clientOptions = {
        hostname: '127.0.0.1',
        port    : portNumber
    };

    server = listen(portNumber, serverOptions);

    (async () =>
    {
        for await (let { socket } of server.listener('connection'))
        {
            connectionHandler(socket, allowedUsers, server);
        }
    })();

    server.addMiddleware(server.MIDDLEWARE_AUTHENTICATE, async function (req)
    {
        if (req.authToken.username === 'alice')
        {
            let err  = new Error('Blocked by MIDDLEWARE_AUTHENTICATE');
            err.name = 'AuthenticateMiddlewareError';
            throw err;
        }
    });

    await server.listener('ready').once();
});

// Close server after each test
afterEach(async () =>
{
    portNumber++;
    destroyTestCase(client, server);
    global.localStorage.removeItem('asyngular.authToken');
});

describe('Socket authentication', () =>
{
    it('Should not send back error if JWT is not provided in handshake', async () =>
    {
        client    = create(clientOptions);
        let event = await client.listener('connect').once();
        expect(event.authError === undefined).toEqual(true);
    });

    it('Should be authenticated on connect if previous JWT token is present', async () =>
    {
        client = create(clientOptions);
        await client.listener('connect').once();
        client.invoke('login', { username: 'bob' });
        await client.listener('authenticate').once();
        expect(client.authState).toEqual('authenticated');
        client.disconnect();
        client.connect();
        let event = await client.listener('connect').once();
        expect(event.isAuthenticated).toEqual(true);
        expect(event.authError === undefined).toEqual(true);
    });

    it('Should send back error if JWT is invalid during handshake', async () =>
    {
        global.localStorage.setItem('asyngular.authToken', validSignedAuthTokenBob);

        client = create(clientOptions);

        await client.listener('connect').once();
        // Change the setAuthKey to invalidate the current token.
        await client.invoke('setAuthKey', 'differentAuthKey');
        client.disconnect();
        client.connect();
        let event = await client.listener('connect').once();
        expect(event.isAuthenticated).toEqual(false);
        expect(event.authError).not.toEqual(null);
        expect(event.authError.name).toEqual('AuthTokenError');
    });

    it('Should allow switching between users', async () =>
    {
        global.localStorage.setItem('asyngular.authToken', validSignedAuthTokenBob);

        let authenticateEvents              = [];
        let deauthenticateEvents            = [];
        let authenticationStateChangeEvents = [];
        let authStateChangeEvents           = [];

        (async () =>
        {
            for await (let stateChangePacket of server.listener('authenticationStateChange'))
            {
                authenticationStateChangeEvents.push(stateChangePacket);
            }
        })();

        (async () =>
        {
            for await (let { socket } of server.listener('connection'))
            {
                (async () =>
                {
                    for await (let { authToken } of socket.listener('authenticate'))
                    {
                        authenticateEvents.push(authToken);
                    }
                })();
                (async () =>
                {
                    for await (let { oldAuthToken } of socket.listener('deauthenticate'))
                    {
                        deauthenticateEvents.push(oldAuthToken);
                    }
                })();
                (async () =>
                {
                    for await (let stateChangeData of socket.listener('authStateChange'))
                    {
                        authStateChangeEvents.push(stateChangeData);
                    }
                })();
            }
        })();

        let clientSocketId;
        client = create(clientOptions);
        await client.listener('connect').once();
        clientSocketId = client.id;
        client.invoke('login', { username: 'alice' });

        await wait(100);

        expect(deauthenticateEvents.length).toEqual(0);
        expect(authenticateEvents.length).toEqual(2);
        expect(authenticateEvents[0].username).toEqual('bob');
        expect(authenticateEvents[1].username).toEqual('alice');

        expect(authenticationStateChangeEvents.length).toEqual(1);
        expect(authenticationStateChangeEvents[0].socket).not.toEqual(null);
        expect(authenticationStateChangeEvents[0].socket.id).toEqual(clientSocketId);
        expect(authenticationStateChangeEvents[0].oldAuthState).toEqual('unauthenticated');
        expect(authenticationStateChangeEvents[0].newAuthState).toEqual('authenticated');
        expect(authenticationStateChangeEvents[0].authToken).not.toEqual(null);
        expect(authenticationStateChangeEvents[0].authToken.username).toEqual('bob');

        expect(authStateChangeEvents.length).toEqual(1);
        expect(authStateChangeEvents[0].oldAuthState).toEqual('unauthenticated');
        expect(authStateChangeEvents[0].newAuthState).toEqual('authenticated');
        expect(authStateChangeEvents[0].authToken).not.toEqual(null);
        expect(authStateChangeEvents[0].authToken.username).toEqual('bob');
    });

    it('Should emit correct events/data when socket is deauthenticated', async () =>
    {
        global.localStorage.setItem('asyngular.authToken', validSignedAuthTokenBob);

        let authenticationStateChangeEvents = [];
        let authStateChangeEvents           = [];

        (async () =>
        {
            for await (let stateChangePacket of server.listener('authenticationStateChange'))
            {
                authenticationStateChangeEvents.push(stateChangePacket);
            }
        })();

        client = create(clientOptions);

        (async () =>
        {
            for await (let event of client.listener('connect'))
            {
                client.deauthenticate();
            }
        })();

        let { socket }       = await server.listener('connection').once();
        let initialAuthToken = socket.authToken;

        (async () =>
        {
            for await (let stateChangeData of socket.listener('authStateChange'))
            {
                authStateChangeEvents.push(stateChangeData);
            }
        })();

        let { oldAuthToken } = await socket.listener('deauthenticate').once();
        expect(oldAuthToken).toEqual(initialAuthToken);

        expect(authStateChangeEvents.length).toEqual(2);
        expect(authStateChangeEvents[0].oldAuthState).toEqual('unauthenticated');
        expect(authStateChangeEvents[0].newAuthState).toEqual('authenticated');
        expect(authStateChangeEvents[0].authToken).not.toEqual(null);
        expect(authStateChangeEvents[0].authToken.username).toEqual('bob');
        expect(authStateChangeEvents[1].oldAuthState).toEqual('authenticated');
        expect(authStateChangeEvents[1].newAuthState).toEqual('unauthenticated');
        expect(authStateChangeEvents[1].authToken).toBeUndefined();

        expect(authenticationStateChangeEvents.length).toEqual(2);
        expect(authenticationStateChangeEvents[0]).not.toEqual(null);
        expect(authenticationStateChangeEvents[0].oldAuthState).toEqual('unauthenticated');
        expect(authenticationStateChangeEvents[0].newAuthState).toEqual('authenticated');
        expect(authenticationStateChangeEvents[0].authToken).not.toEqual(null);
        expect(authenticationStateChangeEvents[0].authToken.username).toEqual('bob');
        expect(authenticationStateChangeEvents[1]).not.toEqual(null);
        expect(authenticationStateChangeEvents[1].oldAuthState).toEqual('authenticated');
        expect(authenticationStateChangeEvents[1].newAuthState).toEqual('unauthenticated');
        expect(authenticationStateChangeEvents[1].authToken).toBeUndefined();
    });

    it('Should not authenticate the client if MIDDLEWARE_AUTHENTICATE blocks the authentication', async () =>
    {
        global.localStorage.setItem('asyngular.authToken', validSignedAuthTokenAlice);

        client = create(clientOptions);
        // The previous test authenticated us as 'alice', so that token will be passed to the server as
        // part of the handshake.

        let event = await client.listener('connect').once();
        // Any token containing the username 'alice' should be blocked by the MIDDLEWARE_AUTHENTICATE middleware.
        // This will only affects token-based authentication, not the credentials-based login event.
        expect(event.isAuthenticated).toEqual(false);
        expect(event.authError).not.toEqual(null);
        expect(event.authError.name).toEqual('AuthenticateMiddlewareError');
    });

    it('Token should be available after Promise resolves if token engine signing is synchronous', async () =>
    {
        portNumber++;
        server = listen(portNumber, {
            authKey      : serverOptions.authKey,
            wsEngine     : WS_ENGINE,
            authSignAsync: false
        });

        (async () =>
        {
            for await (let { socket } of server.listener('connection'))
            {
                connectionHandler(socket, allowedUsers, server);
            }
        })();

        await server.listener('ready').once();

        client = create({
            hostname: clientOptions.hostname,
            port    : portNumber
        });

        await client.listener('connect').once();

        client.invoke('login', { username: 'bob' });
        await client.listener('authenticate').once();

        expect(client.authState).toEqual('authenticated');
        expect(client.authToken).not.toEqual(null);
        expect(client.authToken.username).toEqual('bob');
    });

    it('If token engine signing is asynchronous, authentication can be captured using the authenticate event', async () =>
    {
        portNumber++;
        server = listen(portNumber, {
            authKey      : serverOptions.authKey,
            wsEngine     : WS_ENGINE,
            authSignAsync: true
        });

        (async () =>
        {
            for await (let { socket } of server.listener('connection'))
            {
                connectionHandler(socket, allowedUsers, server);
            }
        })();

        await server.listener('ready').once();

        client = create({
            hostname: clientOptions.hostname,
            port    : portNumber
        });

        await client.listener('connect').once();

        client.invoke('login', { username: 'bob' });
        await client.listener('authenticate').once();

        expect(client.authState).toEqual('authenticated');
        expect(client.authToken).not.toEqual(null);
        expect(client.authToken.username).toEqual('bob');
    });

    it('Should still work if token verification is asynchronous', async () =>
    {
        portNumber++;
        server = listen(portNumber, {
            authKey        : serverOptions.authKey,
            wsEngine       : WS_ENGINE,
            authVerifyAsync: false
        });

        (async () =>
        {
            for await (let { socket } of server.listener('connection'))
            {
                connectionHandler(socket, allowedUsers, server);
            }
        })();

        await server.listener('ready').once();

        client = create({
            hostname: clientOptions.hostname,
            port    : portNumber
        });

        await client.listener('connect').once();

        client.invoke('login', { username: 'bob' });

        await client.listener('authenticate').once();

        client.disconnect();
        client.connect();

        let event = await client.listener('connect').once();

        expect(event.isAuthenticated).toEqual(true);
        expect(client.authToken).not.toEqual(null);
        expect(client.authToken.username).toEqual('bob');
    });

    it('Should set the correct expiry when using expiresIn option when creating a JWT with socket.setAuthToken', async () =>
    {
        portNumber++;
        server = listen(portNumber, {
            authKey        : serverOptions.authKey,
            wsEngine       : WS_ENGINE,
            authVerifyAsync: false
        });

        (async () =>
        {
            for await (let { socket } of server.listener('connection'))
            {
                connectionHandler(socket, allowedUsers, server);
            }
        })();

        await server.listener('ready').once();

        client = create({
            hostname: clientOptions.hostname,
            port    : portNumber
        });

        await client.listener('connect').once();
        client.invoke('loginWithTenDayExpiry', { username: 'bob' });
        await client.listener('authenticate').once();

        expect(client.authToken).not.toEqual(null);
        expect(client.authToken.exp).not.toEqual(null);
        let dateMillisecondsInTenDays = Date.now() + TEN_DAYS_IN_SECONDS * 1000;
        let dateDifference            = Math.abs(dateMillisecondsInTenDays - client.authToken.exp * 1000);
        // Expiry must be accurate within 1000 milliseconds.
        expect(dateDifference < 1000).toEqual(true);
    });

    it('Should set the correct expiry when adding exp claim when creating a JWT with socket.setAuthToken', async () =>
    {
        portNumber++;
        server = listen(portNumber, {
            authKey        : serverOptions.authKey,
            wsEngine       : WS_ENGINE,
            authVerifyAsync: false
        });

        (async () =>
        {
            for await (let { socket } of server.listener('connection'))
            {
                connectionHandler(socket, allowedUsers, server);
            }
        })();

        await server.listener('ready').once();

        client = create({
            hostname: clientOptions.hostname,
            port    : portNumber
        });

        await client.listener('connect').once();
        client.invoke('loginWithTenDayExp', { username: 'bob' });
        await client.listener('authenticate').once();

        expect(client.authToken).not.toEqual(null);
        expect(client.authToken.exp).not.toEqual(null);
        let dateMillisecondsInTenDays = Date.now() + TEN_DAYS_IN_SECONDS * 1000;
        let dateDifference            = Math.abs(dateMillisecondsInTenDays - client.authToken.exp * 1000);
        // Expiry must be accurate within 1000 milliseconds.
        expect(dateDifference < 1000).toEqual(true);
    });

    it('The exp claim should have priority over expiresIn option when using socket.setAuthToken', async () =>
    {
        portNumber++;
        server = listen(portNumber, {
            authKey        : serverOptions.authKey,
            wsEngine       : WS_ENGINE,
            authVerifyAsync: false
        });

        (async () =>
        {
            for await (let { socket } of server.listener('connection'))
            {
                connectionHandler(socket, allowedUsers, server);
            }
        })();

        await server.listener('ready').once();

        client = create({
            hostname: clientOptions.hostname,
            port    : portNumber
        });

        await client.listener('connect').once();
        client.invoke('loginWithTenDayExpAndExpiry', { username: 'bob' });
        await client.listener('authenticate').once();

        expect(client.authToken).not.toEqual(null);
        expect(client.authToken.exp).not.toEqual(null);
        let dateMillisecondsInTenDays = Date.now() + TEN_DAYS_IN_SECONDS * 1000;
        let dateDifference            = Math.abs(dateMillisecondsInTenDays - client.authToken.exp * 1000);
        // Expiry must be accurate within 1000 milliseconds.
        expect(dateDifference < 1000).toEqual(true);
    });

    it('Should send back error if socket.setAuthToken tries to set both iss claim and issuer option', async () =>
    {
        portNumber++;
        server         = listen(portNumber, {
            authKey        : serverOptions.authKey,
            wsEngine       : WS_ENGINE,
            authVerifyAsync: false
        });
        let warningMap = {};

        (async () =>
        {
            for await (let { socket } of server.listener('connection'))
            {
                connectionHandler(socket, allowedUsers, server);
            }
        })();

        await server.listener('ready').once();

        client = create({
            hostname: clientOptions.hostname,
            port    : portNumber
        });

        await client.listener('connect').once();

        (async () =>
        {
            await client.listener('authenticate').once();
            throw new Error('Should not pass authentication because the signature should fail');
        })();

        (async () =>
        {
            for await (let { warning } of server.listener('warning'))
            {
                expect(warning).not.toEqual(null);
                warningMap[warning.name] = warning;
            }
        })();

        (async () =>
        {
            for await (let { error } of server.listener('error'))
            {
                expect(error).not.toEqual(null);
                expect(error.name).toEqual('SocketProtocolError');
            }
        })();

        let closePackets = [];

        (async () =>
        {
            let event = await client.listener('close').once();
            closePackets.push(event);
        })();

        let error;
        try
        {
            await client.invoke('loginWithIssAndIssuer', { username: 'bob' });
        }
        catch (err)
        {
            error = err;
        }

        expect(error).not.toEqual(null);
        expect(error.name).toEqual('BadConnectionError');

        await wait(1000);

        expect(closePackets.length).toEqual(1);
        expect(closePackets[0].code).toEqual(4002);
        server.closeListener('warning');
        expect(warningMap['SocketProtocolError']).not.toEqual(null);
    });

    it('Should trigger an authTokenSigned event and socket.signedAuthToken should be set after calling the socket.setAuthToken method', async () =>
    {
        portNumber++;
        server = listen(portNumber, {
            authKey      : serverOptions.authKey,
            wsEngine     : WS_ENGINE,
            authSignAsync: true
        });

        let authTokenSignedEventEmitted = false;

        (async () =>
        {
            for await (let { socket } of server.listener('connection'))
            {
                (async () =>
                {
                    for await (let { signedAuthToken } of socket.listener('authTokenSigned'))
                    {
                        authTokenSignedEventEmitted = true;
                        expect(signedAuthToken).not.toEqual(null);
                        expect(signedAuthToken).toEqual(socket.signedAuthToken);
                    }
                })();

                (async () =>
                {
                    for await (let req of socket.procedure('login'))
                    {
                        if (allowedUsers[req.data.username])
                        {
                            socket.setAuthToken(req.data);
                            req.end();
                        }
                        else
                        {
                            let err  = new Error('Failed to login');
                            err.name = 'FailedLoginError';
                            req.error(err);
                        }
                    }
                })();
            }
        })();

        await server.listener('ready').once();

        client = create({
            hostname: clientOptions.hostname,
            port    : portNumber
        });

        await client.listener('connect').once();
        await client.invoke('login', { username: 'bob' });
        await client.listener('authenticate').once();

        expect(authTokenSignedEventEmitted).toEqual(true);
    });

    it('Should reject Promise returned by socket.setAuthToken if token delivery fails and rejectOnFailedDelivery option is true', async () =>
    {
        portNumber++;
        server = listen(portNumber, {
            authKey      : serverOptions.authKey,
            wsEngine     : WS_ENGINE,
            authSignAsync: true,
            ackTimeout   : 1000
        });

        let socketErrors = [];

        (async () =>
        {
            await server.listener('ready').once();
            client = create({
                hostname: clientOptions.hostname,
                port    : portNumber
            });
            await client.listener('connect').once();
            client.invoke('login', { username: 'bob' });
        })();

        let { socket } = await server.listener('connection').once();

        (async () =>
        {
            for await (let { error } of socket.listener('error'))
            {
                socketErrors.push(error);
            }
        })();

        let req = await socket.procedure('login').once();
        if (allowedUsers[req.data.username])
        {
            req.end();
            socket.disconnect();
            let error;
            try
            {
                await socket.setAuthToken(req.data, { rejectOnFailedDelivery: true });
            }
            catch (err)
            {
                error = err;
            }
            expect(error).not.toEqual(null);
            expect(error.name).toEqual('AuthError');
            await wait(0);
            expect(socketErrors[0]).not.toEqual(null);
            expect(socketErrors[0].name).toEqual('AuthError');
        }
        else
        {
            let err  = new Error('Failed to login');
            err.name = 'FailedLoginError';
            req.error(err);
        }
    });

    it('Should not reject Promise returned by socket.setAuthToken if token delivery fails and rejectOnFailedDelivery option is not true', async () =>
    {
        portNumber++;
        server = listen(portNumber, {
            authKey      : serverOptions.authKey,
            wsEngine     : WS_ENGINE,
            authSignAsync: true,
            ackTimeout   : 1000
        });

        let socketErrors = [];

        (async () =>
        {
            await server.listener('ready').once();
            client = create({
                hostname: clientOptions.hostname,
                port    : portNumber
            });
            await client.listener('connect').once();
            client.invoke('login', { username: 'bob' });
        })();

        let { socket } = await server.listener('connection').once();

        (async () =>
        {
            for await (let { error } of socket.listener('error'))
            {
                socketErrors.push(error);
            }
        })();

        let req = await socket.procedure('login').once();
        if (allowedUsers[req.data.username])
        {
            req.end();
            socket.disconnect();
            let error;
            try
            {
                await socket.setAuthToken(req.data);
            }
            catch (err)
            {
                error = err;
            }
            expect(error).toBeUndefined();
            await wait(0);
            expect(socketErrors[0]).not.toEqual(null);
            expect(socketErrors[0].name).toEqual('AuthError');
        }
        else
        {
            let err  = new Error('Failed to login');
            err.name = 'FailedLoginError';
            req.error(err);
        }
    });

    it('The verifyToken method of the authEngine receives correct params', async () =>
    {
        global.localStorage.setItem('asyngular.authToken', validSignedAuthTokenBob);

        portNumber++;
        server = listen(portNumber, {
            authKey : serverOptions.authKey,
            wsEngine: WS_ENGINE
        });

        (async () =>
        {
            for await (let { socket } of server.listener('connection'))
            {
                connectionHandler(socket, allowedUsers, server);
            }
        })();

        (async () =>
        {
            await server.listener('ready').once();
            client = create({
                hostname: clientOptions.hostname,
                port    : portNumber
            });
        })();

        return new Promise<void>((resolve) =>
        {
            server.setAuthEngine({
                verifyToken: async (signedAuthToken, verificationKey, verificationOptions) =>
                {
                    await wait(500);
                    expect(signedAuthToken).toEqual(validSignedAuthTokenBob);
                    expect(verificationKey).toEqual(serverOptions.authKey);
                    expect(verificationOptions).not.toEqual(null);
                    // TODO: 'socket' in JwtVerifyOptions
                    // expect(verificationOptions.socket).not.toEqual(null);
                    resolve();
                    return Promise.resolve({});
                }
            });
        });
    });

    it('Should remove client data from the server when client disconnects before authentication process finished', async () =>
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

        (async () =>
        {
            for await (let { socket } of server.listener('connection'))
            {
                connectionHandler(socket, allowedUsers, server);
            }
        })();

        await server.listener('ready').once();
        client = create({
            hostname: clientOptions.hostname,
            port    : portNumber
        });

        let serverSocket;
        (async () =>
        {
            for await (let { socket } of server.listener('handshake'))
            {
                serverSocket = socket;
            }
        })();

        await wait(100);
        expect(server.clientsCount).toEqual(0);
        expect(server.pendingClientsCount).toEqual(1);
        expect(serverSocket).not.toEqual(null);
        expect(Object.keys(server.pendingClients)[0]).toEqual(serverSocket.id);
        client.disconnect();

        await wait(1000);
        expect(Object.keys(server.clients).length).toEqual(0);
        expect(server.clientsCount).toEqual(0);
        expect(server.pendingClientsCount).toEqual(0);
        expect(JSON.stringify(server.pendingClients)).toEqual('{}');
    });
});