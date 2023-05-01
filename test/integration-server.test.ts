import * as localStorage from 'localStorage';
import { JwtVerifyOptions } from 'topgun-jsonwebtoken';
import { ClientOptions, create, TGClientSocket } from '../src/socket-client';
import {
    listen,
    TGAction,
    TGServerSocketGateway,
    TGServerSocketGatewayOptions
} from '../src/socket-server';
import { wait } from '../src/utils/wait';

// Add to the global scope like in browser.
global.localStorage = localStorage;

let clientOptions: ClientOptions;
let serverOptions: TGServerSocketGatewayOptions;
let server: TGServerSocketGateway;
let client: TGClientSocket;

let allowedUsers = {
    bob  : true,
    alice: true
};

const PORT_NUMBER  = 8008;
const WS_ENGINE    = 'ws';
const LOG_WARNINGS = false;
const LOG_ERRORS   = false;

const TEN_DAYS_IN_SECONDS = 60 * 60 * 24 * 10;

let validSignedAuthTokenBob   = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VybmFtZSI6ImJvYiIsImV4cCI6MzE2Mzc1ODk3OTA4MDMxMCwiaWF0IjoxNTAyNzQ3NzQ2fQ.dSZOfsImq4AvCu-Or3Fcmo7JNv1hrV3WqxaiSKkTtAo';
let validSignedAuthTokenAlice = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VybmFtZSI6ImFsaWNlIiwiaWF0IjoxNTE4NzI4MjU5LCJleHAiOjMxNjM3NTg5NzkwODAzMTB9.XxbzPPnnXrJfZrS0FJwb_EAhIu2VY5i7rGyUThtNLh4';
let invalidSignedAuthToken    = 'fakebGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.fakec2VybmFtZSI6ImJvYiIsImlhdCI6MTUwMjYyNTIxMywiZXhwIjoxNTAyNzExNjEzfQ.fakemYcOOjM9bzmS4UYRvlWSk_lm3WGHvclmFjLbyOk';

async function resolveAfterTimeout(duration, value)
{
    await wait(duration);
    return value;
}

function connectionHandler(socket)
{
    (async () =>
    {
        for await (let rpc of socket.procedure('login'))
        {
            if (rpc.data && allowedUsers[rpc.data.username])
            {
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
    })();

    (async () =>
    {
        for await (let rpc of socket.procedure('loginWithTenDayExpiry'))
        {
            if (allowedUsers[rpc.data.username])
            {
                socket.setAuthToken(rpc.data, {
                    expiresIn: TEN_DAYS_IN_SECONDS
                });
                rpc.end();
            }
            else
            {
                let err  = new Error('Failed to login');
                err.name = 'FailedLoginError';
                rpc.error(err);
            }
        }
    })();

    (async () =>
    {
        for await (let rpc of socket.procedure('loginWithTenDayExp'))
        {
            if (allowedUsers[rpc.data.username])
            {
                rpc.data.exp = Math.round(Date.now() / 1000) + TEN_DAYS_IN_SECONDS;
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
    })();

    (async () =>
    {
        for await (let rpc of socket.procedure('loginWithTenDayExpAndExpiry'))
        {
            if (allowedUsers[rpc.data.username])
            {
                rpc.data.exp = Math.round(Date.now() / 1000) + TEN_DAYS_IN_SECONDS;
                socket.setAuthToken(rpc.data, {
                    expiresIn: TEN_DAYS_IN_SECONDS * 100 // 1000 days
                });
                rpc.end();
            }
            else
            {
                let err  = new Error('Failed to login');
                err.name = 'FailedLoginError';
                rpc.error(err);
            }
        }
    })();

    (async () =>
    {
        for await (let rpc of socket.procedure('loginWithIssAndIssuer'))
        {
            if (allowedUsers[rpc.data.username])
            {
                rpc.data.iss = 'foo';
                try
                {
                    await socket.setAuthToken(rpc.data, {
                        issuer: 'bar'
                    });
                }
                catch (err)
                {
                }
                rpc.end();
            }
            else
            {
                let err  = new Error('Failed to login');
                err.name = 'FailedLoginError';
                rpc.error(err);
            }
        }
    })();

    (async () =>
    {
        for await (let rpc of socket.procedure('setAuthKey'))
        {
            server.signatureKey    = rpc.data;
            server.verificationKey = rpc.data;
            rpc.end();
        }
    })();

    (async () =>
    {
        for await (let rpc of socket.procedure('proc'))
        {
            rpc.end('success ' + rpc.data);
        }
    })();
}

function bindFailureHandlers(server)
{
    if (LOG_ERRORS)
    {
        (async () =>
        {
            for await (let { error } of server.listener('error'))
            {
                console.error('ERROR', error);
            }
        })();
    }
    if (LOG_WARNINGS)
    {
        (async () =>
        {
            for await (let { warning } of server.listener('warning'))
            {
                console.warn('WARNING', warning);
            }
        })();
    }
}

describe('Integration tests', () =>
{
    beforeEach(async () =>
    {
        clientOptions = {
            hostname: '127.0.0.1',
            port    : PORT_NUMBER
        };
        serverOptions = {
            authKey : 'testkey',
            wsEngine: WS_ENGINE
        };
    });

    afterEach(async () =>
    {
        if (client)
        {
            client.closeAllListeners();
            client.disconnect();
        }
        if (server)
        {
            server.closeAllListeners();
            server.httpServer.close();
            await server.close();
        }
        global.localStorage.removeItem('topgunsocket.authToken');
    });

    describe('Client authentication', () =>
    {
        beforeEach(async () =>
        {
            server = listen(PORT_NUMBER, serverOptions);
            bindFailureHandlers(server);

            server.setMiddleware(server.MIDDLEWARE_INBOUND, async (middlewareStream: any) =>
            {
                for await (let action of middlewareStream)
                {
                    if (
                        action.type === TGAction.AUTHENTICATE &&
                        (!action.authToken || action.authToken.username === 'alice')
                    )
                    {
                        let err  = new Error('Blocked by MIDDLEWARE_INBOUND');
                        err.name = 'AuthenticateMiddlewareError';
                        action.block(err);
                        continue;
                    }
                    action.allow();
                }
            });

            (async () =>
            {
                for await (let { socket } of server.listener('connection'))
                {
                    connectionHandler(socket);
                }
            })();

            await server.listener('ready').once();
        });

        it(
            'Should not send back error if JWT is not provided in handshake',
            async () =>
            {
                client    = create(clientOptions);
                let event = await client.listener('connect').once();
                expect(event.authError === undefined).toEqual(true);
            }
        );

        it(
            'Should be authenticated on connect if previous JWT token is present',
            async () =>
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
            }
        );

        it(
            'Should send back error if JWT is invalid during handshake',
            async () =>
            {
                global.localStorage.setItem('topgunsocket.authToken', validSignedAuthTokenBob);

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
            }
        );

        it('Should allow switching between users', async () =>
        {
            global.localStorage.setItem('topgunsocket.authToken', validSignedAuthTokenBob);

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

        it(
            'Should emit correct events/data when socket is deauthenticated',
            async () =>
            {
                global.localStorage.setItem('topgunsocket.authToken', validSignedAuthTokenBob);

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
                expect(authStateChangeEvents[1].authToken).toEqual(null);

                expect(authenticationStateChangeEvents.length).toEqual(2);
                expect(authenticationStateChangeEvents[0]).not.toEqual(null);
                expect(authenticationStateChangeEvents[0].oldAuthState).toEqual('unauthenticated');
                expect(authenticationStateChangeEvents[0].newAuthState).toEqual('authenticated');
                expect(authenticationStateChangeEvents[0].authToken).not.toEqual(null);
                expect(authenticationStateChangeEvents[0].authToken.username).toEqual('bob');
                expect(authenticationStateChangeEvents[1]).not.toEqual(null);
                expect(authenticationStateChangeEvents[1].oldAuthState).toEqual('authenticated');
                expect(authenticationStateChangeEvents[1].newAuthState).toEqual('unauthenticated');
                expect(authenticationStateChangeEvents[1].authToken).toEqual(null);
            }
        );

        it(
            'Should throw error if server socket deauthenticate is called after client disconnected and rejectOnFailedDelivery is true',
            async () =>
            {
                global.localStorage.setItem('topgunsocket.authToken', validSignedAuthTokenBob);

                client = create(clientOptions);

                let { socket } = await server.listener('connection').once();

                client.disconnect();
                let error;
                try
                {
                    await socket.deauthenticate({ rejectOnFailedDelivery: true });
                }
                catch (err)
                {
                    error = err;
                }
                expect(error).not.toEqual(null);
                expect(error.name).toEqual('BadConnectionError');
            }
        );

        it(
            'Should not throw error if server socket deauthenticate is called after client disconnected and rejectOnFailedDelivery is not true',
            async () =>
            {
                global.localStorage.setItem('topgunsocket.authToken', validSignedAuthTokenBob);

                client = create(clientOptions);

                let { socket } = await server.listener('connection').once();

                client.disconnect();
                socket.deauthenticate();
            }
        );

        it(
            'Should not authenticate the client if MIDDLEWARE_INBOUND blocks the authentication',
            async () =>
            {
                global.localStorage.setItem('topgunsocket.authToken', validSignedAuthTokenAlice);

                client = create(clientOptions);
                // The previous test authenticated us as 'alice', so that token will be passed to the server as
                // part of the handshake.
                let event = await client.listener('connect').once();
                // Any token containing the username 'alice' should be blocked by the MIDDLEWARE_INBOUND middleware.
                // This will only affects token-based authentication, not the credentials-based login event.
                expect(event.isAuthenticated).toEqual(false);
                expect(event.authError).not.toEqual(null);
                expect(event.authError.name).toEqual('AuthenticateMiddlewareError');
            }
        );
    });

    describe('Server authentication', () =>
    {
        it(
            'Token should be available after the authenticate listener resolves',
            async () =>
            {
                server = listen(PORT_NUMBER, {
                    authKey : serverOptions.authKey,
                    wsEngine: WS_ENGINE
                });
                bindFailureHandlers(server);

                (async () =>
                {
                    for await (let { socket } of server.listener('connection'))
                    {
                        connectionHandler(socket);
                    }
                })();

                await server.listener('ready').once();

                client = create({
                    hostname: clientOptions.hostname,
                    port    : PORT_NUMBER
                });

                await client.listener('connect').once();

                client.invoke('login', { username: 'bob' });
                await client.listener('authenticate').once();

                expect(client.authState).toEqual('authenticated');
                expect(client.authToken).not.toEqual(null);
                expect(client.authToken.username).toEqual('bob');
            }
        );

        it(
            'Authentication can be captured using the authenticate listener',
            async () =>
            {
                server = listen(PORT_NUMBER, {
                    authKey : serverOptions.authKey,
                    wsEngine: WS_ENGINE
                });
                bindFailureHandlers(server);

                (async () =>
                {
                    for await (let { socket } of server.listener('connection'))
                    {
                        connectionHandler(socket);
                    }
                })();

                await server.listener('ready').once();

                client = create({
                    hostname: clientOptions.hostname,
                    port    : PORT_NUMBER
                });

                await client.listener('connect').once();

                client.invoke('login', { username: 'bob' });
                await client.listener('authenticate').once();

                expect(client.authState).toEqual('authenticated');
                expect(client.authToken).not.toEqual(null);
                expect(client.authToken.username).toEqual('bob');
            }
        );

        it(
            'Previously authenticated client should still be authenticated after reconnecting',
            async () =>
            {
                server = listen(PORT_NUMBER, {
                    authKey : serverOptions.authKey,
                    wsEngine: WS_ENGINE
                });
                bindFailureHandlers(server);

                (async () =>
                {
                    for await (let { socket } of server.listener('connection'))
                    {
                        connectionHandler(socket);
                    }
                })();

                await server.listener('ready').once();

                client = create({
                    hostname: clientOptions.hostname,
                    port    : PORT_NUMBER
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
            }
        );

        it(
            'Should set the correct expiry when using expiresIn option when creating a JWT with socket.setAuthToken',
            async () =>
            {
                server = listen(PORT_NUMBER, {
                    authKey : serverOptions.authKey,
                    wsEngine: WS_ENGINE
                });
                bindFailureHandlers(server);

                (async () =>
                {
                    for await (let { socket } of server.listener('connection'))
                    {
                        connectionHandler(socket);
                    }
                })();

                await server.listener('ready').once();

                client = create({
                    hostname: clientOptions.hostname,
                    port    : PORT_NUMBER
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
            }
        );

        it(
            'Should set the correct expiry when adding exp claim when creating a JWT with socket.setAuthToken',
            async () =>
            {
                server = listen(PORT_NUMBER, {
                    authKey : serverOptions.authKey,
                    wsEngine: WS_ENGINE
                });
                bindFailureHandlers(server);

                (async () =>
                {
                    for await (let { socket } of server.listener('connection'))
                    {
                        connectionHandler(socket);
                    }
                })();

                await server.listener('ready').once();

                client = create({
                    hostname: clientOptions.hostname,
                    port    : PORT_NUMBER
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
            }
        );

        it(
            'The exp claim should have priority over expiresIn option when using socket.setAuthToken',
            async () =>
            {
                server = listen(PORT_NUMBER, {
                    authKey : serverOptions.authKey,
                    wsEngine: WS_ENGINE
                });
                bindFailureHandlers(server);

                (async () =>
                {
                    for await (let { socket } of server.listener('connection'))
                    {
                        connectionHandler(socket);
                    }
                })();

                await server.listener('ready').once();

                client = create({
                    hostname: clientOptions.hostname,
                    port    : PORT_NUMBER
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
            }
        );

        it(
            'Should send back error if socket.setAuthToken tries to set both iss claim and issuer option',
            async () =>
            {
                server = listen(PORT_NUMBER, {
                    authKey : serverOptions.authKey,
                    wsEngine: WS_ENGINE
                });
                bindFailureHandlers(server);

                let warningMap = {};

                (async () =>
                {
                    for await (let { socket } of server.listener('connection'))
                    {
                        connectionHandler(socket);
                    }
                })();

                await server.listener('ready').once();

                client = create({
                    hostname: clientOptions.hostname,
                    port    : PORT_NUMBER
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

                expect(error).not.toBeNull();
                expect(error).not.toBeUndefined();
                expect(error?.name).toEqual('BadConnectionError');

                await wait(1000);

                expect(closePackets.length).toEqual(1);
                expect(closePackets[0].code).toEqual(4002);
                server.closeListener('warning');
                expect(warningMap['SocketProtocolError']).not.toEqual(null);
            }
        );

        it(
            'Should trigger an authTokenSigned event and socket.signedAuthToken should be set after calling the socket.setAuthToken method',
            async () =>
            {
                server = listen(PORT_NUMBER, {
                    authKey : serverOptions.authKey,
                    wsEngine: WS_ENGINE
                });
                bindFailureHandlers(server);

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
                    port    : PORT_NUMBER
                });

                await client.listener('connect').once();

                await Promise.all([
                    client.invoke('login', { username: 'bob' }),
                    client.listener('authenticate').once()
                ]);

                expect(authTokenSignedEventEmitted).toEqual(true);
            }
        );

        it(
            'The socket.setAuthToken call should reject if token delivery fails and rejectOnFailedDelivery option is true',
            async () =>
            {
                server = listen(PORT_NUMBER, {
                    authKey   : serverOptions.authKey,
                    wsEngine  : WS_ENGINE,
                    ackTimeout: 1000
                });
                bindFailureHandlers(server);

                let serverWarnings = [];

                (async () =>
                {
                    await server.listener('ready').once();
                    client = create({
                        hostname: clientOptions.hostname,
                        port    : PORT_NUMBER
                    });
                    await client.listener('connect').once();
                    client.invoke('login', { username: 'bob' });
                })();

                let { socket } = await server.listener('connection').once();

                (async () =>
                {
                    for await (let { warning } of server.listener('warning'))
                    {
                        serverWarnings.push(warning);
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
                    expect(serverWarnings[0]).not.toEqual(null);
                    expect(serverWarnings[0].name).toEqual('BadConnectionError');
                    expect(serverWarnings[1]).not.toEqual(null);
                    expect(serverWarnings[1].name).toEqual('AuthError');
                }
                else
                {
                    let err  = new Error('Failed to login');
                    err.name = 'FailedLoginError';
                    req.error(err);
                }
            }
        );

        it(
            'The socket.setAuthToken call should not reject if token delivery fails and rejectOnFailedDelivery option is not true',
            async () =>
            {
                server = listen(PORT_NUMBER, {
                    authKey   : serverOptions.authKey,
                    wsEngine  : WS_ENGINE,
                    ackTimeout: 1000
                });
                bindFailureHandlers(server);

                let serverWarnings = [];

                (async () =>
                {
                    await server.listener('ready').once();
                    client = create({
                        hostname: clientOptions.hostname,
                        port    : PORT_NUMBER
                    });
                    await client.listener('connect').once();
                    client.invoke('login', { username: 'bob' });
                })();

                let { socket } = await server.listener('connection').once();

                (async () =>
                {
                    for await (let { warning } of server.listener('warning'))
                    {
                        serverWarnings.push(warning);
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
                    expect(serverWarnings[0]).not.toEqual(null);
                    expect(serverWarnings[0].name).toEqual('BadConnectionError');
                }
                else
                {
                    let err  = new Error('Failed to login');
                    err.name = 'FailedLoginError';
                    req.error(err);
                }
            }
        );

        it(
            'The verifyToken method of the authEngine receives correct params',
            async () =>
            {
                global.localStorage.setItem('topgunsocket.authToken', validSignedAuthTokenBob);

                server = listen(PORT_NUMBER, {
                    authKey : serverOptions.authKey,
                    wsEngine: WS_ENGINE
                });
                bindFailureHandlers(server);

                (async () =>
                {
                    for await (let { socket } of server.listener('connection'))
                    {
                        connectionHandler(socket);
                    }
                })();

                (async () =>
                {
                    await server.listener('ready').once();
                    client = create({
                        hostname: clientOptions.hostname,
                        port    : PORT_NUMBER
                    });
                })();

                return new Promise<void>((resolve) =>
                {
                    server.setAuthEngine({
                        verifyToken: async (signedAuthToken: string, verificationKey: string, verificationOptions: JwtVerifyOptions) =>
                        {
                            await wait(500);
                            expect(signedAuthToken).toEqual(validSignedAuthTokenBob);
                            expect(verificationKey).toEqual(serverOptions.authKey);
                            expect(verificationOptions).not.toEqual(null);
                            // expect(verificationOptions.socket).not.toEqual(null);
                            resolve();
                            return Promise.resolve({});
                        }
                    });
                });
            }
        );

        it(
            'Should remove client data from the server when client disconnects before authentication process finished',
            async () =>
            {
                server = listen(PORT_NUMBER, {
                    authKey : serverOptions.authKey,
                    wsEngine: WS_ENGINE
                });
                bindFailureHandlers(server);

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
                        connectionHandler(socket);
                    }
                })();

                await server.listener('ready').once();
                client = create({
                    hostname: clientOptions.hostname,
                    port    : PORT_NUMBER
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
            }
        );
    });

    describe('Socket handshake', () =>
    {
        it(
            'Exchange is attached to socket before the handshake event is triggered',
            async () =>
            {
                server = listen(PORT_NUMBER, {
                    authKey : serverOptions.authKey,
                    wsEngine: WS_ENGINE
                });
                bindFailureHandlers(server);

                (async () =>
                {
                    for await (let { socket } of server.listener('connection'))
                    {
                        connectionHandler(socket);
                    }
                })();

                await server.listener('ready').once();

                client = create({
                    hostname: clientOptions.hostname,
                    port    : PORT_NUMBER
                });

                let { socket } = await server.listener('handshake').once();
                expect(socket.exchange).not.toEqual(null);
            }
        );

        it(
            'Should close the connection if the client tries to send a message before the handshake',
            async () =>
            {
                server = listen(PORT_NUMBER, {
                    authKey : serverOptions.authKey,
                    wsEngine: WS_ENGINE
                });

                (async () =>
                {
                    for await (let { socket } of server.listener('connection'))
                    {
                        connectionHandler(socket);
                    }
                })();

                await server.listener('ready').once();

                client = create({
                    hostname: clientOptions.hostname,
                    port    : PORT_NUMBER
                });

                client.transport.socket.onopen = function ()
                {
                    client.transport.socket.send(Buffer.alloc(0));
                };

                let results = await Promise.all([
                    server.listener('closure').once(200),
                    client.listener('close').once(200)
                ]);
                expect(results[0].code).toEqual(4009);
                expect(results[0].reason).toEqual('Server received a message before the client handshake');
                expect(results[1].code).toEqual(4009);
                expect(results[1].reason).toEqual('Server received a message before the client handshake');
            }
        );

        it(
            'Should close the connection if the client tries to send a ping before the handshake',
            async () =>
            {
                server = listen(PORT_NUMBER, {
                    authKey : serverOptions.authKey,
                    wsEngine: WS_ENGINE
                });

                (async () =>
                {
                    for await (let { socket } of server.listener('connection'))
                    {
                        connectionHandler(socket);
                    }
                })();

                await server.listener('ready').once();

                client = create({
                    hostname: clientOptions.hostname,
                    port    : PORT_NUMBER
                });

                client.transport.socket.onopen = function ()
                {
                    client.transport.socket.send('');
                };

                let { code: closeCode } = await client.listener('close').once(200);

                expect(closeCode).toEqual(4009);
            }
        );

        it(
            'Should not close the connection if the client tries to send a message before the handshake and strictHandshake is false',
            async () =>
            {
                server = listen(PORT_NUMBER, {
                    authKey        : serverOptions.authKey,
                    wsEngine       : WS_ENGINE,
                    strictHandshake: false
                });

                (async () =>
                {
                    for await (let { socket } of server.listener('connection'))
                    {
                        connectionHandler(socket);
                    }
                })();

                await server.listener('ready').once();

                client = create({
                    hostname: clientOptions.hostname,
                    port    : PORT_NUMBER
                });

                let realOnOpenFunction = client.transport.socket.onopen;

                client.transport.socket.onopen = function ()
                {
                    client.transport.socket.send(Buffer.alloc(0));
                    return realOnOpenFunction.apply(this, arguments);
                };

                let packet = await client.listener('connect').once(200);

                expect(packet).not.toEqual(null);
                expect(packet.id).not.toEqual(null);
            }
        );
    });

    describe('Socket connection', () =>
    {
        it(
            'Server-side socket connect event and server connection event should trigger',
            async () =>
            {
                server = listen(PORT_NUMBER, {
                    authKey : serverOptions.authKey,
                    wsEngine: WS_ENGINE
                });
                bindFailureHandlers(server);

                let connectionEmitted = false;
                let connectionEvent;

                (async () =>
                {
                    for await (let event of server.listener('connection'))
                    {
                        connectionEvent = event;
                        connectionHandler(event.socket);
                        connectionEmitted = true;
                    }
                })();

                await server.listener('ready').once();

                client = create({
                    hostname: clientOptions.hostname,
                    port    : PORT_NUMBER
                });

                let connectEmitted = false;
                let connectStatus;
                let socketId;

                (async () =>
                {
                    for await (let { socket } of server.listener('handshake'))
                    {
                        (async () =>
                        {
                            for await (let serverSocketStatus of socket.listener('connect'))
                            {
                                socketId       = socket.id;
                                connectEmitted = true;
                                connectStatus  = serverSocketStatus;
                                // This is to check that mutating the status on the server
                                // doesn't affect the status sent to the client.
                                serverSocketStatus.foo = 123;
                            }
                        })();
                    }
                })();

                let clientConnectEmitted: any = false;
                let clientConnectStatus: any  = false;

                (async () =>
                {
                    for await (let event of client.listener('connect'))
                    {
                        clientConnectEmitted = true;
                        clientConnectStatus  = event;
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
                expect(clientConnectStatus.foo).toBeUndefined();
                // Client socket status should be a clone of server socket status; not
                // a reference to the same object.
                expect(clientConnectStatus.foo).not.toEqual(connectStatus.foo);
            }
        );
    });

    describe('Socket disconnection', () =>
    {
        it(
            'Server-side socket disconnect event should not trigger if the socket did not complete the handshake; instead, it should trigger connectAbort',
            async () =>
            {
                server = listen(PORT_NUMBER, {
                    authKey : serverOptions.authKey,
                    wsEngine: WS_ENGINE
                });
                bindFailureHandlers(server);

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
                        connectionHandler(socket);
                    }
                })();

                await server.listener('ready').once();

                client = create({
                    hostname: clientOptions.hostname,
                    port    : PORT_NUMBER
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
            }
        );

        it(
            'Server-side socket disconnect event should trigger if the socket completed the handshake (not connectAbort)',
            async () =>
            {
                server = listen(PORT_NUMBER, {
                    authKey : serverOptions.authKey,
                    wsEngine: WS_ENGINE
                });
                bindFailureHandlers(server);

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
                        connectionHandler(socket);
                    }
                })();

                await server.listener('ready').once();

                client = create({
                    hostname: clientOptions.hostname,
                    port    : PORT_NUMBER
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
            }
        );

        it(
            'The close event should trigger when the socket loses the connection before the handshake',
            async () =>
            {
                server = listen(PORT_NUMBER, {
                    authKey : serverOptions.authKey,
                    wsEngine: WS_ENGINE
                });
                bindFailureHandlers(server);

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
                        connectionHandler(socket);
                    }
                })();

                await server.listener('ready').once();

                client = create({
                    hostname: clientOptions.hostname,
                    port    : PORT_NUMBER
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
            }
        );

        it(
            'The close event should trigger when the socket loses the connection after the handshake',
            async () =>
            {
                server = listen(PORT_NUMBER, {
                    authKey : serverOptions.authKey,
                    wsEngine: WS_ENGINE
                });
                bindFailureHandlers(server);

                server.setAuthEngine({
                    verifyToken: function (signedAuthToken, verificationKey, verificationOptions)
                    {
                        return resolveAfterTimeout(0, {});
                    }
                });

                let connectionOnServer = false;

                (async () =>
                {
                    for await (let { socket } of server.listener('connection'))
                    {
                        connectionOnServer = true;
                        connectionHandler(socket);
                    }
                })();

                await server.listener('ready').once();

                client = create({
                    hostname: clientOptions.hostname,
                    port    : PORT_NUMBER
                });

                let serverSocketClosed  = false;
                let serverDisconnection = false;
                let serverClosure       = false;

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
                        serverDisconnection = true;
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
                expect(serverDisconnection).toEqual(true);
                expect(serverClosure).toEqual(true);
            }
        );

        it(
            'Disconnection should support socket message backpressure',
            async () =>
            {
                server = listen(PORT_NUMBER, {
                    authKey : serverOptions.authKey,
                    wsEngine: WS_ENGINE
                });
                bindFailureHandlers(server);

                let serverWarnings = [];
                (async () =>
                {
                    for await (let { warning } of server.listener('warning'))
                    {
                        serverWarnings.push(warning);
                    }
                })();

                await server.listener('ready').once();

                client = create({
                    hostname: clientOptions.hostname,
                    port    : PORT_NUMBER
                });

                let currentRequestData            = null;
                let requestDataAtTimeOfDisconnect = null;
                let connectionOnServer            = false;

                (async () =>
                {
                    for await (let { socket } of server.listener('connection'))
                    {
                        connectionOnServer = true;
                        connectionHandler(socket);

                        (async () =>
                        {
                            await socket.listener('disconnect').once();
                            requestDataAtTimeOfDisconnect = currentRequestData;
                        })();

                        (async () =>
                        {
                            for await (let request of socket.procedure('foo'))
                            {
                                currentRequestData = request.data;
                                await wait(10);
                                (async () =>
                                {
                                    try
                                    {
                                        await socket.invoke('bla', request.data);
                                    }
                                    catch (err)
                                    {
                                    }
                                })();
                                socket.transmit('hi', request.data);
                                request.end('bar');
                                if (request.data === 10)
                                {
                                    client.disconnect();
                                }
                            }
                        })();
                    }
                })();

                for (let i = 0; i < 30; i++)
                {
                    (async () =>
                    {
                        let result;
                        try
                        {
                            result = await client.invoke('foo', i);
                        }
                        catch (error)
                        {
                            return;
                        }
                    })();
                }

                await wait(200);

                // Expect a server warning (socket error) if a response was sent on a disconnected socket.
                expect(serverWarnings.some((warning) =>
                {
                    return warning.message.match(/WebSocket is not open/g);
                })).toEqual(true);

                // Expect a server warning (socket error) if transmit was called on a disconnected socket.
                expect(serverWarnings.some((warning) =>
                {
                    return warning.name === 'BadConnectionError' && warning.message.match(/Socket transmit "hi" was aborted/g);
                })).toEqual(true);

                // Expect a server warning (socket error) if invoke was called on a disconnected socket.
                expect(serverWarnings.some((warning) =>
                {
                    return warning.name === 'BadConnectionError' && warning.message.match(/Socket invoke "bla" was aborted/g);
                })).toEqual(true);

                // Check that the disconnect event on the back end socket triggers as soon as possible (out-of-band) and not at the end of the stream.
                // Any value less than 30 indicates that the 'disconnect' event was triggerred out-of-band.
                // Since the client disconnect() call is executed on the 11th message, we can assume that the 'disconnect' event will trigger sooner.
                expect(requestDataAtTimeOfDisconnect < 15).toEqual(true);
            }
        );

        it(
            'Socket streams should be killed immediately if socket disconnects (default/kill mode)',
            async () =>
            {
                server = listen(PORT_NUMBER, {
                    authKey : serverOptions.authKey,
                    wsEngine: WS_ENGINE
                });
                bindFailureHandlers(server);

                let handledPackets = [];
                let closedReceiver = false;

                (async () =>
                {
                    for await (let { socket } of server.listener('connection'))
                    {
                        (async () =>
                        {
                            for await (let packet of socket.receiver('foo'))
                            {
                                await wait(30);
                                handledPackets.push(packet);
                            }
                            closedReceiver = true;
                        })();
                    }
                })();

                await server.listener('ready').once();

                client = create({
                    hostname: clientOptions.hostname,
                    port    : PORT_NUMBER
                });

                await wait(100);

                for (let i = 0; i < 15; i++)
                {
                    client.transmit('foo', i);
                }

                await wait(110);

                client.disconnect(4445, 'Disconnect');

                await wait(500);
                expect(handledPackets.length).toEqual(4);
                expect(closedReceiver).toEqual(true);
            }
        );

        it(
            'Socket streams should be closed eventually if socket disconnects (close mode)',
            async () =>
            {
                server = listen(PORT_NUMBER, {
                    authKey                : serverOptions.authKey,
                    wsEngine               : WS_ENGINE,
                    socketStreamCleanupMode: 'close'
                });
                bindFailureHandlers(server);

                let handledPackets = [];
                let closedReceiver = false;

                (async () =>
                {
                    for await (let { socket } of server.listener('connection'))
                    {
                        (async () =>
                        {
                            for await (let packet of socket.receiver('foo'))
                            {
                                await wait(30);
                                handledPackets.push(packet);
                            }
                            closedReceiver = true;
                        })();
                    }
                })();

                await server.listener('ready').once();

                client = create({
                    hostname: clientOptions.hostname,
                    port    : PORT_NUMBER
                });

                await wait(100);

                for (let i = 0; i < 15; i++)
                {
                    client.transmit('foo', i);
                }

                await wait(110);

                client.disconnect(4445, 'Disconnect');

                await wait(500);
                expect(handledPackets.length).toEqual(15);
                expect(closedReceiver).toEqual(true);
            }
        );

        it(
            'Socket streams should be closed eventually if socket disconnects (none mode)',
            async () =>
            {
                server = listen(PORT_NUMBER, {
                    authKey                : serverOptions.authKey,
                    wsEngine               : WS_ENGINE,
                    socketStreamCleanupMode: 'none'
                });
                bindFailureHandlers(server);

                let handledPackets = [];
                let closedReceiver = false;

                (async () =>
                {
                    for await (let { socket } of server.listener('connection'))
                    {
                        (async () =>
                        {
                            for await (let packet of socket.receiver('foo'))
                            {
                                await wait(30);
                                handledPackets.push(packet);
                            }
                            closedReceiver = false;
                        })();
                    }
                })();

                await server.listener('ready').once();

                client = create({
                    hostname: clientOptions.hostname,
                    port    : PORT_NUMBER
                });

                await wait(100);

                for (let i = 0; i < 15; i++)
                {
                    client.transmit('foo', i);
                }

                await wait(110);

                client.disconnect(4445, 'Disconnect');

                await wait(500);
                expect(handledPackets.length).toEqual(15);
                expect(closedReceiver).toEqual(false);
            }
        );
    });

    /*describe('Socket RPC invoke', () =>
    {
        it(
            'Should support invoking a remote procedure on the server',
            async () =>
            {
                server = listen(http, PORT_NUMBER, {
                    authKey : serverOptions.authKey,
                    wsEngine: WS_ENGINE
                });
                bindFailureHandlers(server);

                (async () =>
                {
                    for await (let { socket } of server.listener('connection'))
                    {
                        (async () =>
                        {
                            for await (let req of socket.procedure('customProc'))
                            {
                                if (req.data.bad)
                                {
                                    let error  = new Error('Server failed to execute the procedure');
                                    error.name = 'BadCustomError';
                                    req.error(error);
                                }
                                else
                                {
                                    req.end('Success');
                                }
                            }
                        })();
                    }
                })();

                client = create({
                    hostname: clientOptions.hostname,
                    port    : PORT_NUMBER
                });

                let result = await client.invoke('customProc', { good: true });
                expect(result).toEqual('Success');

                let error;
                try
                {
                    result = await client.invoke('customProc', { bad: true });
                }
                catch (err)
                {
                    error = err;
                }
                expect(error).not.toEqual(null);
                expect(error.name).toEqual('BadCustomError');
            }
        );
    });

    describe('Socket transmit', () =>
    {
        it(
            'Should support receiving remote transmitted data on the server',
            async () =>
            {
                server = listen(http, PORT_NUMBER, {
                    authKey : serverOptions.authKey,
                    wsEngine: WS_ENGINE
                });
                bindFailureHandlers(server);

                (async () =>
                {
                    await wait(10);

                    client = create({
                        hostname: clientOptions.hostname,
                        port    : PORT_NUMBER
                    });

                    client.transmit('customRemoteEvent', 'This is data');
                })();

                for await (let { socket } of server.listener('connection'))
                {
                    for await (let data of socket.receiver('customRemoteEvent'))
                    {
                        expect(data).toEqual('This is data');
                        break;
                    }
                    break;
                }
            }
        );
    });

    describe('Socket backpressure', () =>
    {
        it(
            'Should be able to getInboundBackpressure() on a socket object',
            async () =>
            {
                server = listen(http, PORT_NUMBER, {
                    authKey : serverOptions.authKey,
                    wsEngine: WS_ENGINE
                });
                bindFailureHandlers(server);

                let backpressureHistory = [];

                server.setMiddleware(server.MIDDLEWARE_INBOUND_RAW, async (middlewareStream) =>
                {
                    for await (let action of middlewareStream)
                    {
                        backpressureHistory.push(action['socket'].getInboundBackpressure());
                        action.allow();
                    }
                });

                server.setMiddleware(server.MIDDLEWARE_INBOUND, async (middlewareStream) =>
                {
                    for await (let action of middlewareStream)
                    {
                        if (action['data'] === 5)
                        {
                            await wait(100);
                        }
                        action.allow();
                    }
                });

                await server.listener('ready').once();

                client = create({
                    hostname: clientOptions.hostname,
                    port    : PORT_NUMBER
                });

                await client.listener('connect').once();
                for (let i = 0; i < 20; i++)
                {
                    await wait(10);
                    client.transmitPublish('foo', i);
                }

                await wait(400);

                // Backpressure should go up and come back down.
                expect(backpressureHistory.length).toEqual(21);
                expect(backpressureHistory[0]).toEqual(1);
                expect(backpressureHistory[12] > 4).toEqual(true);
                expect(backpressureHistory[14] > 6).toEqual(true);
                expect(backpressureHistory[19]).toEqual(1);
            }
        );

        it(
            'Should be able to getOutboundBackpressure() on a socket object',
            async () =>
            {
                server = listen(http, PORT_NUMBER, {
                    authKey : serverOptions.authKey,
                    wsEngine: WS_ENGINE
                });
                bindFailureHandlers(server);

                let backpressureHistory = [];

                (async () =>
                {
                    for await (let { socket } of server.listener('connection'))
                    {
                        (async () =>
                        {
                            await socket.listener('subscribe').once();

                            for (let i = 0; i < 20; i++)
                            {
                                await wait(10);
                                server.exchange.transmitPublish('foo', i);
                                backpressureHistory.push(socket.getOutboundBackpressure());
                            }
                        })();
                    }
                })();

                server.setMiddleware(server.MIDDLEWARE_OUTBOUND, async (middlewareStream) =>
                {
                    for await (let action of middlewareStream)
                    {
                        if (action['data'] === 5)
                        {
                            await wait(100);
                        }
                        action.allow();
                    }
                });

                await server.listener('ready').once();

                client = create({
                    hostname: clientOptions.hostname,
                    port    : PORT_NUMBER
                });

                await client.subscribe('foo').listener('subscribe').once();

                await wait(400);

                // Backpressure should go up and come back down.
                expect(backpressureHistory.length).toEqual(20);
                expect(backpressureHistory[0]).toEqual(1);
                expect(backpressureHistory[13] > 7).toEqual(true);
                // expect(backpressureHistory[14] > 8).toEqual(true);
                expect(backpressureHistory[19]).toEqual(1);
            }
        );

        it(
            'Should be able to getBackpressure() on a socket object and it should be the highest backpressure',
            async () =>
            {
                server = listen(http, PORT_NUMBER, {
                    authKey : serverOptions.authKey,
                    wsEngine: WS_ENGINE
                });
                bindFailureHandlers(server);

                let backpressureHistory = [];

                server.setMiddleware(server.MIDDLEWARE_INBOUND_RAW, async (middlewareStream) =>
                {
                    for await (let action of middlewareStream)
                    {
                        backpressureHistory.push(action['socket'].getBackpressure());
                        action.allow();
                    }
                });

                server.setMiddleware(server.MIDDLEWARE_INBOUND, async (middlewareStream) =>
                {
                    for await (let action of middlewareStream)
                    {
                        if (action['data'] === 5)
                        {
                            await wait(100);
                        }
                        action.allow();
                    }
                });

                await server.listener('ready').once();

                client = create({
                    hostname: clientOptions.hostname,
                    port    : PORT_NUMBER
                });

                await client.listener('connect').once();
                for (let i = 0; i < 20; i++)
                {
                    await wait(10);
                    client.transmitPublish('foo', i);
                }

                await wait(400);

                // Backpressure should go up and come back down.
                expect(backpressureHistory.length).toEqual(21);
                expect(backpressureHistory[0]).toEqual(1);
                expect(backpressureHistory[12] > 4).toEqual(true);
                expect(backpressureHistory[14] > 6).toEqual(true);
                expect(backpressureHistory[19]).toEqual(1);
            }
        );
    });

    describe('Socket pub/sub', () =>
    {
        it('Should maintain order of publish and subscribe', async () =>
        {
            server = listen(http, PORT_NUMBER, {
                authKey : serverOptions.authKey,
                wsEngine: WS_ENGINE
            });
            bindFailureHandlers(server);

            (async () =>
            {
                for await (let { socket } of server.listener('connection'))
                {
                    connectionHandler(socket);
                }
            })();

            await server.listener('ready').once();

            client = create({
                hostname: clientOptions.hostname,
                port    : PORT_NUMBER
            });

            await client.listener('connect').once();

            let receivedMessages = [];

            (async () =>
            {
                for await (let data of client.subscribe('foo'))
                {
                    receivedMessages.push(data);
                }
            })();

            await client.invokePublish('foo', 123);

            expect(client.state).toEqual(client.OPEN);
            await wait(100);
            expect(receivedMessages.length).toEqual(1);
        });

        it(
            'Should maintain order of publish and subscribe when client starts out as disconnected',
            async () =>
            {
                server = listen(http, PORT_NUMBER, {
                    authKey : serverOptions.authKey,
                    wsEngine: WS_ENGINE
                });
                bindFailureHandlers(server);

                (async () =>
                {
                    for await (let { socket } of server.listener('connection'))
                    {
                        connectionHandler(socket);
                    }
                })();

                await server.listener('ready').once();

                client = create({
                    hostname   : clientOptions.hostname,
                    port       : PORT_NUMBER,
                    autoConnect: false
                });

                expect(client.state).toEqual(client.CLOSED);

                let receivedMessages = [];

                (async () =>
                {
                    for await (let data of client.subscribe('foo'))
                    {
                        receivedMessages.push(data);
                    }
                })();

                client.invokePublish('foo', 123);

                await wait(100);
                expect(client.state).toEqual(client.OPEN);
                expect(receivedMessages.length).toEqual(1);
            }
        );

        it(
            'Client should not be able to subscribe to a channel before the handshake has completed',
            async () =>
            {
                server = listen(http, PORT_NUMBER, {
                    authKey : serverOptions.authKey,
                    wsEngine: WS_ENGINE
                });
                bindFailureHandlers(server);

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
                        connectionHandler(socket);
                    }
                })();

                await server.listener('ready').once();

                client = create({
                    hostname: clientOptions.hostname,
                    port    : PORT_NUMBER
                });

                let isSubscribed = false;
                let error;

                (async () =>
                {
                    for await (let event of server.listener('subscription'))
                    {
                        isSubscribed = true;
                    }
                })();

                // Hack to capture the error without relying on the standard client flow.
                client.transport._callbackMap[2] = {
                    event   : '#subscribe',
                    data    : { 'channel': 'someChannel' },
                    callback: function (err)
                    {
                        error = err;
                    }
                };

                // Trick the server by sending a fake subscribe before the handshake is done.
                client.transport.socket.on('open', function ()
                {
                    client.send('{"event":"#subscribe","data":{"channel":"someChannel"},"cid":2}');
                });

                await wait(1000);
                expect(isSubscribed).toEqual(false);
                expect(error).not.toEqual(null);
                expect(error.name).toEqual('BadConnectionError');
            }
        );

        it(
            'Server should be able to handle invalid #subscribe and #unsubscribe and #publish events without crashing',
            async () =>
            {
                server = listen(http, PORT_NUMBER, {
                    authKey : serverOptions.authKey,
                    wsEngine: WS_ENGINE
                });
                bindFailureHandlers(server);

                (async () =>
                {
                    for await (let { socket } of server.listener('connection'))
                    {
                        connectionHandler(socket);
                    }
                })();

                await server.listener('ready').once();

                client = create({
                    hostname: clientOptions.hostname,
                    port    : PORT_NUMBER
                });

                let nullInChannelArrayError;
                let objectAsChannelNameError;
                let nullChannelNameError;
                let nullUnsubscribeError;

                let undefinedPublishError;
                let objectAsChannelNamePublishError;
                let nullPublishError;

                // Hacks to capture the errors without relying on the standard client flow.
                client.transport._callbackMap[2] = {
                    event   : '#subscribe',
                    data    : [null],
                    callback: function (err)
                    {
                        nullInChannelArrayError = err;
                    }
                };
                client.transport._callbackMap[3] = {
                    event   : '#subscribe',
                    data    : { 'channel': { 'hello': 123 } },
                    callback: function (err)
                    {
                        objectAsChannelNameError = err;
                    }
                };
                client.transport._callbackMap[4] = {
                    event   : '#subscribe',
                    data    : null,
                    callback: function (err)
                    {
                        nullChannelNameError = err;
                    }
                };
                client.transport._callbackMap[5] = {
                    event   : '#unsubscribe',
                    data    : [null],
                    callback: function (err)
                    {
                        nullUnsubscribeError = err;
                    }
                };
                client.transport._callbackMap[6] = {
                    event   : '#publish',
                    data    : null,
                    callback: function (err)
                    {
                        undefinedPublishError = err;
                    }
                };
                client.transport._callbackMap[7] = {
                    event   : '#publish',
                    data    : { 'channel': { 'hello': 123 } },
                    callback: function (err)
                    {
                        objectAsChannelNamePublishError = err;
                    }
                };
                client.transport._callbackMap[8] = {
                    event   : '#publish',
                    data    : { 'channel': null },
                    callback: function (err)
                    {
                        nullPublishError = err;
                    }
                };

                (async () =>
                {
                    for await (let event of client.listener('connect'))
                    {
                        // Trick the server by sending a fake subscribe before the handshake is done.
                        client.send('{"event":"#subscribe","data":[null],"cid":2}');
                        client.send('{"event":"#subscribe","data":{"channel":{"hello":123}},"cid":3}');
                        client.send('{"event":"#subscribe","data":null,"cid":4}');
                        client.send('{"event":"#unsubscribe","data":[null],"cid":5}');
                        client.send('{"event":"#publish","data":null,"cid":6}');
                        client.send('{"event":"#publish","data":{"channel":{"hello":123}},"cid":7}');
                        client.send('{"event":"#publish","data":{"channel":null},"cid":8}');
                    }
                })();

                await wait(300);

                expect(nullInChannelArrayError).not.toEqual(null);
                expect(objectAsChannelNameError).not.toEqual(null);
                expect(nullChannelNameError).not.toEqual(null);
                expect(nullUnsubscribeError).not.toEqual(null);
                expect(undefinedPublishError).not.toEqual(null);
                expect(objectAsChannelNamePublishError).not.toEqual(null);
                expect(nullPublishError).not.toEqual(null);
            }
        );

        it(
            'When default TGSimpleBroker broker engine is used, disconnect event should trigger before unsubscribe event',
            async () =>
            {
                server = listen(http, PORT_NUMBER, {
                    authKey : serverOptions.authKey,
                    wsEngine: WS_ENGINE
                });
                bindFailureHandlers(server);

                let eventList = [];

                (async () =>
                {
                    await server.listener('ready').once();

                    client = create({
                        hostname: clientOptions.hostname,
                        port    : PORT_NUMBER
                    });

                    await client.subscribe('foo').listener('subscribe').once();
                    await wait(200);
                    client.disconnect();
                })();

                let { socket } = await server.listener('connection').once();

                (async () =>
                {
                    for await (let event of socket.listener('unsubscribe'))
                    {
                        eventList.push({
                            type   : 'unsubscribe',
                            channel: event.channel
                        });
                    }
                })();

                (async () =>
                {
                    for await (let disconnectPacket of socket.listener('disconnect'))
                    {
                        eventList.push({
                            type  : 'disconnect',
                            code  : disconnectPacket.code,
                            reason: disconnectPacket.data
                        });
                    }
                })();

                await wait(300);
                expect(eventList[0].type).toEqual('disconnect');
                expect(eventList[1].type).toEqual('unsubscribe');
                expect(eventList[1].channel).toEqual('foo');
            }
        );

        it(
            'When default TGSimpleBroker broker engine is used, agServer.exchange should support consuming data from a channel',
            async () =>
            {
                server = listen(http, PORT_NUMBER, {
                    authKey : serverOptions.authKey,
                    wsEngine: WS_ENGINE
                });
                bindFailureHandlers(server);

                await server.listener('ready').once();

                client = create({
                    hostname: clientOptions.hostname,
                    port    : PORT_NUMBER
                });

                (async () =>
                {
                    await client.listener('connect').once();

                    client.transmitPublish('foo', 'hi1');
                    await wait(10);
                    client.transmitPublish('foo', 'hi2');
                })();

                let receivedSubscribedData = [];
                let receivedChannelData    = [];

                (async () =>
                {
                    let subscription = server.exchange.subscribe('foo');
                    for await (let data of subscription)
                    {
                        receivedSubscribedData.push(data);
                    }
                })();

                let channel = server.exchange.channel('foo');
                for await (let data of channel)
                {
                    receivedChannelData.push(data);
                    if (receivedChannelData.length > 1)
                    {
                        break;
                    }
                }

                expect(server.exchange.isSubscribed('foo')).toEqual(true);
                expect(server.exchange.subscriptions().join(',')).toEqual('foo');

                expect(receivedSubscribedData[0]).toEqual('hi1');
                expect(receivedSubscribedData[1]).toEqual('hi2');
                expect(receivedChannelData[0]).toEqual('hi1');
                expect(receivedChannelData[1]).toEqual('hi2');
            }
        );

        it(
            'When default TGSimpleBroker broker engine is used, agServer.exchange should support publishing data to a channel',
            async () =>
            {
                server = listen(http, PORT_NUMBER, {
                    authKey : serverOptions.authKey,
                    wsEngine: WS_ENGINE
                });
                bindFailureHandlers(server);

                await server.listener('ready').once();

                client = create({
                    hostname: clientOptions.hostname,
                    port    : PORT_NUMBER
                });

                (async () =>
                {
                    await client.listener('subscribe').once();
                    server.exchange.transmitPublish('bar', 'hello1');
                    await wait(10);
                    server.exchange.transmitPublish('bar', 'hello2');
                })();

                let receivedSubscribedData = [];
                let receivedChannelData    = [];

                (async () =>
                {
                    let subscription = client.subscribe('bar');
                    for await (let data of subscription)
                    {
                        receivedSubscribedData.push(data);
                    }
                })();

                let channel = client.channel('bar');
                for await (let data of channel)
                {
                    receivedChannelData.push(data);
                    if (receivedChannelData.length > 1)
                    {
                        break;
                    }
                }

                expect(receivedSubscribedData[0]).toEqual('hello1');
                expect(receivedSubscribedData[1]).toEqual('hello2');
                expect(receivedChannelData[0]).toEqual('hello1');
                expect(receivedChannelData[1]).toEqual('hello2');
            }
        );

        it(
            'When disconnecting a socket, the unsubscribe event should trigger after the disconnect and close events',
            async () =>
            {
                let customBrokerEngine               = new TGSimpleBroker();
                let defaultUnsubscribeSocket         = customBrokerEngine.unsubscribeSocket;
                customBrokerEngine.unsubscribeSocket = function (socket, channel)
                {
                    return resolveAfterTimeout(100, defaultUnsubscribeSocket.call(this, socket, channel));
                };

                server = listen(http, PORT_NUMBER, {
                    authKey     : serverOptions.authKey,
                    wsEngine    : WS_ENGINE,
                    brokerEngine: customBrokerEngine
                });
                bindFailureHandlers(server);

                let eventList = [];

                (async () =>
                {
                    await server.listener('ready').once();
                    client = create({
                        hostname: clientOptions.hostname,
                        port    : PORT_NUMBER
                    });

                    for await (let event of client.subscribe('foo').listener('subscribe'))
                    {
                        (async () =>
                        {
                            await wait(200);
                            client.disconnect();
                        })();
                    }
                })();

                let { socket } = await server.listener('connection').once();

                (async () =>
                {
                    for await (let event of socket.listener('unsubscribe'))
                    {
                        eventList.push({
                            type   : 'unsubscribe',
                            channel: event.channel
                        });
                    }
                })();

                (async () =>
                {
                    for await (let event of socket.listener('disconnect'))
                    {
                        eventList.push({
                            type  : 'disconnect',
                            code  : event.code,
                            reason: event.reason
                        });
                    }
                })();

                (async () =>
                {
                    for await (let event of socket.listener('close'))
                    {
                        eventList.push({
                            type  : 'close',
                            code  : event.code,
                            reason: event.reason
                        });
                    }
                })();

                await wait(700);
                expect(eventList[0].type).toEqual('disconnect');
                expect(eventList[1].type).toEqual('close');
                expect(eventList[2].type).toEqual('unsubscribe');
                expect(eventList[2].channel).toEqual('foo');
            }
        );

        it(
            'Socket should emit an error when trying to unsubscribe from a channel which it is not subscribed to',
            async () =>
            {
                server = listen(http, PORT_NUMBER, {
                    authKey : serverOptions.authKey,
                    wsEngine: WS_ENGINE
                });
                bindFailureHandlers(server);

                let errorList = [];

                (async () =>
                {
                    for await (let { socket } of server.listener('connection'))
                    {
                        (async () =>
                        {
                            for await (let { error } of socket.listener('error'))
                            {
                                errorList.push(error);
                            }
                        })();
                    }
                })();

                await server.listener('ready').once();

                client = create({
                    hostname: clientOptions.hostname,
                    port    : PORT_NUMBER
                });

                let error;
                try
                {
                    await client.invoke('#unsubscribe', 'bar');
                }
                catch (err)
                {
                    error = err;
                }
                expect(error).not.toEqual(null);
                expect(error.name).toEqual('BrokerError');

                await wait(100);
                expect(errorList.length).toEqual(1);
                expect(errorList[0].name).toEqual('BrokerError');
            }
        );

        it(
            'Socket should not receive messages from a channel which it has only just unsubscribed from (accounting for delayed unsubscribe by brokerEngine)',
            async () =>
            {
                let customBrokerEngine               = new TGSimpleBroker();
                let defaultUnsubscribeSocket         = customBrokerEngine.unsubscribeSocket;
                customBrokerEngine.unsubscribeSocket = function (socket, channel)
                {
                    return resolveAfterTimeout(300, defaultUnsubscribeSocket.call(this, socket, channel));
                };

                server = listen(http, PORT_NUMBER, {
                    authKey     : serverOptions.authKey,
                    wsEngine    : WS_ENGINE,
                    brokerEngine: customBrokerEngine
                });
                bindFailureHandlers(server);

                (async () =>
                {
                    for await (let { socket } of server.listener('connection'))
                    {
                        (async () =>
                        {
                            for await (let event of socket.listener('unsubscribe'))
                            {
                                if (event.channel === 'foo')
                                {
                                    server.exchange.transmitPublish('foo', 'hello');
                                }
                            }
                        })();
                    }
                })();

                await server.listener('ready').once();

                client = create({
                    hostname: clientOptions.hostname,
                    port    : PORT_NUMBER
                });
                // Stub the isSubscribed method so that it always returns true.
                // That way the client will always invoke watchers whenever
                // it receives a #publish event.
                client.isSubscribed = function ()
                {
                    return true;
                };

                let messageList = [];

                let fooChannel = client.subscribe('foo');

                (async () =>
                {
                    for await (let data of fooChannel)
                    {
                        messageList.push(data);
                    }
                })();

                (async () =>
                {
                    for await (let event of fooChannel.listener('subscribe'))
                    {
                        client.invoke('#unsubscribe', 'foo');
                    }
                })();

                await wait(200);
                expect(messageList.length).toEqual(0);
            }
        );

        it(
            'Socket channelSubscriptions and channelSubscriptionsCount should update when socket.kickOut(channel) is called',
            async () =>
            {
                server = listen(http, PORT_NUMBER, {
                    authKey : serverOptions.authKey,
                    wsEngine: WS_ENGINE
                });
                bindFailureHandlers(server);

                let errorList        = [];
                let serverSocket;
                let wasKickOutCalled = false;

                (async () =>
                {
                    for await (let { socket } of server.listener('connection'))
                    {
                        serverSocket = socket;

                        (async () =>
                        {
                            for await (let { error } of socket.listener('error'))
                            {
                                errorList.push(error);
                            }
                        })();

                        (async () =>
                        {
                            for await (let event of socket.listener('subscribe'))
                            {
                                if (event.channel === 'foo')
                                {
                                    await wait(50);
                                    wasKickOutCalled = true;
                                    socket.kickOut('foo', 'Socket was kicked out of the channel');
                                }
                            }
                        })();
                    }
                })();

                await server.listener('ready').once();

                client = create({
                    hostname: clientOptions.hostname,
                    port    : PORT_NUMBER
                });

                client.subscribe('foo');

                await wait(100);
                expect(errorList.length).toEqual(0);
                expect(wasKickOutCalled).toEqual(true);
                expect(serverSocket.channelSubscriptionsCount).toEqual(0);
                expect(Object.keys(serverSocket.channelSubscriptions).length).toEqual(0);
            }
        );
    });

    describe('Batching', () =>
    {
        it(
            'Should batch messages sent through sockets after the handshake when the batchOnHandshake option is true',
            async () =>
            {
                server = listen(http, PORT_NUMBER, {
                    authKey                 : serverOptions.authKey,
                    wsEngine                : WS_ENGINE,
                    batchOnHandshake        : true,
                    batchOnHandshakeDuration: 400,
                    batchInterval           : 50
                });
                bindFailureHandlers(server);

                let receivedServerMessages = [];

                (async () =>
                {
                    for await (let { socket } of server.listener('connection'))
                    {
                        connectionHandler(socket);

                        (async () =>
                        {
                            for await (let { message } of socket.listener('message'))
                            {
                                receivedServerMessages.push(message);
                            }
                        })();
                    }
                })();

                let subscribeMiddlewareCounter = 0;

                // Each subscription should pass through the middleware individually, even
                // though they were sent as a batch/array.
                server.setMiddleware(server.MIDDLEWARE_INBOUND, async function (middlewareStream)
                {
                    for await (let action of middlewareStream)
                    {
                        if (action.type === TGAction.SUBSCRIBE)
                        {
                            subscribeMiddlewareCounter++;
                            expect(action['channel'].indexOf('my-channel-')).toEqual(0);
                            if (action['channel'] === 'my-channel-10')
                            {
                                expect(JSON.stringify(action['data'])).toEqual(JSON.stringify({ foo: 123 }));
                            }
                            else if (action['channel'] === 'my-channel-12')
                            {
                                // Block my-channel-12
                                let err  = new Error('You cannot subscribe to channel 12');
                                err.name = 'UnauthorizedSubscribeError';
                                action.block(err);
                                continue;
                            }
                        }
                        action.allow();
                    }
                });

                await server.listener('ready').once();

                client = create({
                    hostname                : clientOptions.hostname,
                    port                    : PORT_NUMBER,
                    batchOnHandshake        : true,
                    batchOnHandshakeDuration: 100,
                    batchInterval           : 50
                });

                let receivedClientMessages = [];
                (async () =>
                {
                    for await (let { message } of client.listener('message'))
                    {
                        receivedClientMessages.push(message);
                    }
                })();

                let channelList = [];
                for (let i = 0; i < 20; i++)
                {
                    let subscriptionOptions: any = {};
                    if (i === 10)
                    {
                        subscriptionOptions.data = { foo: 123 };
                    }
                    channelList.push(
                        client.subscribe('my-channel-' + i, subscriptionOptions)
                    );
                }

                (async () =>
                {
                    for await (let event of channelList[12].listener('subscribe'))
                    {
                        throw new Error('The my-channel-12 channel should have been blocked by MIDDLEWARE_SUBSCRIBE');
                    }
                })();

                (async () =>
                {
                    for await (let event of channelList[12].listener('subscribeFail'))
                    {
                        expect(event.error).not.toEqual(null);
                        expect(event.error.name).toEqual('UnauthorizedSubscribeError');
                    }
                })();

                (async () =>
                {
                    for await (let event of channelList[19].listener('subscribe'))
                    {
                        client.transmitPublish('my-channel-19', 'Hello!');
                    }
                })();

                for await (let data of channelList[19])
                {
                    expect(data).toEqual('Hello!');
                    expect(subscribeMiddlewareCounter).toEqual(20);
                    break;
                }

                expect(receivedServerMessages[0]).not.toEqual(null);
                // All 20 subscriptions should arrive as a single message.
                expect(JSON.parse(receivedServerMessages[0]).length).toEqual(20);

                expect(Array.isArray(JSON.parse(receivedClientMessages[0]))).toEqual(false);
                expect(JSON.parse(receivedClientMessages[1]).length).toEqual(20);
            }
        );

        it(
            'The batchOnHandshake option should not break the order of subscribe and publish',
            async () =>
            {
                server = listen(http, PORT_NUMBER, {
                    authKey                 : serverOptions.authKey,
                    wsEngine                : WS_ENGINE,
                    batchOnHandshake        : true,
                    batchOnHandshakeDuration: 400,
                    batchInterval           : 50
                });
                bindFailureHandlers(server);

                (async () =>
                {
                    for await (let { socket } of server.listener('connection'))
                    {
                        connectionHandler(socket);
                    }
                })();

                await server.listener('ready').once();

                client = create({
                    hostname                : clientOptions.hostname,
                    port                    : PORT_NUMBER,
                    autoConnect             : false,
                    batchOnHandshake        : true,
                    batchOnHandshakeDuration: 100,
                    batchInterval           : 50
                });

                let receivedMessage;

                let fooChannel = client.subscribe('foo');
                client.transmitPublish('foo', 'bar');

                for await (let data of fooChannel)
                {
                    receivedMessage = data;
                    break;
                }
            }
        );
    });

    describe('Socket Ping/pong', () =>
    {
        describe('When pingTimeoutDisabled is not set', () =>
        {
            beforeEach(async () =>
            {
                // Intentionally make pingInterval higher than pingTimeout, that
                // way the client will never receive a ping or send back a pong.
                server = listen(http, PORT_NUMBER, {
                    authKey     : serverOptions.authKey,
                    wsEngine    : WS_ENGINE,
                    pingInterval: 2000,
                    pingTimeout : 500
                });
                bindFailureHandlers(server);

                await server.listener('ready').once();
            });

            it(
                'Should disconnect socket if server does not receive a pong from client before timeout',
                async () =>
                {
                    client = create({
                        hostname: clientOptions.hostname,
                        port    : PORT_NUMBER
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
                    expect(clientDisconnectCode === 4000 || clientDisconnectCode === 4001).toEqual(true);

                    expect(serverWarning).not.toEqual(null);
                    expect(serverWarning.name).toEqual('SocketProtocolError');
                    expect(clientDisconnectCode === 4000 || clientDisconnectCode === 4001).toEqual(true);
                }
            );
        });

        describe('When pingTimeoutDisabled is true', () =>
        {
            beforeEach(async () =>
            {
                // Intentionally make pingInterval higher than pingTimeout, that
                // way the client will never receive a ping or send back a pong.
                server = listen(http, PORT_NUMBER, {
                    authKey            : serverOptions.authKey,
                    wsEngine           : WS_ENGINE,
                    pingInterval       : 2000,
                    pingTimeout        : 500,
                    pingTimeoutDisabled: true
                });
                bindFailureHandlers(server);

                await server.listener('ready').once();
            });

            it(
                'Should not disconnect socket if server does not receive a pong from client before timeout',
                async () =>
                {
                    client = create({
                        hostname           : clientOptions.hostname,
                        port               : PORT_NUMBER,
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
                }
            );
        });

        describe('When pingTimeout is greater than pingInterval', () =>
        {
            beforeEach(async () =>
            {
                // Intentionally make pingInterval higher than pingTimeout, that
                // way the client will never receive a ping or send back a pong.
                server = listen(http, PORT_NUMBER, {
                    authKey     : serverOptions.authKey,
                    wsEngine    : WS_ENGINE,
                    pingInterval: 400,
                    pingTimeout : 1000
                });
                bindFailureHandlers(server);

                await server.listener('ready').once();
            });

            it(
                'Should not disconnect socket if server receives a pong from client before timeout',
                async () =>
                {
                    client = create({
                        hostname: clientOptions.hostname,
                        port    : PORT_NUMBER
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

                    await wait(2000);
                    expect(clientError).toEqual(null);
                    expect(clientDisconnectCode).toEqual(null);

                    expect(serverWarning).toEqual(null);
                    expect(serverDisconnectionCode).toEqual(null);
                }
            );
        });
    });

    describe('Middleware', () =>
    {
        beforeEach(async () =>
        {
            server = listen(http, PORT_NUMBER, {
                authKey : serverOptions.authKey,
                wsEngine: WS_ENGINE
            });
            bindFailureHandlers(server);

            (async () =>
            {
                for await (let { socket } of server.listener('connection'))
                {
                    connectionHandler(socket);
                }
            })();

            await server.listener('ready').once();
        });

        describe('MIDDLEWARE_HANDSHAKE', () =>
        {
            describe('HANDSHAKE_WS action', () =>
            {
                it(
                    'Delaying handshake for one client should not affect other clients',
                    async () =>
                    {
                        let middlewareFunction = async function (middlewareStream)
                        {
                            for await (let action of middlewareStream)
                            {
                                if (action.type === TGAction.HANDSHAKE_WS)
                                {
                                    if (action.request.url.indexOf('?delayMe=true') !== -1)
                                    {
                                        // Long delay.
                                        await wait(5000);
                                        action.allow();
                                        continue;
                                    }
                                }
                                action.allow();
                            }
                        };
                        server.setMiddleware(server.MIDDLEWARE_HANDSHAKE, middlewareFunction);

                        let clientA = create({
                            hostname: clientOptions.hostname,
                            port    : PORT_NUMBER
                        });

                        let clientB = create({
                            hostname: clientOptions.hostname,
                            port    : PORT_NUMBER,
                            query   : {
                                delayMe: true
                            }
                        });

                        let clientAIsConnected = false;
                        let clientBIsConnected = false;

                        (async () =>
                        {
                            await clientA.listener('connect').once();
                            clientAIsConnected = true;
                        })();

                        (async () =>
                        {
                            await clientB.listener('connect').once();
                            clientBIsConnected = true;
                        })();

                        await wait(100);

                        expect(clientAIsConnected).toEqual(true);
                        expect(clientBIsConnected).toEqual(false);

                        clientA.disconnect();
                        clientB.disconnect();
                    }
                );
            });

            describe('HANDSHAKE_SC action', () =>
            {
                it(
                    'Should trigger correct events if MIDDLEWARE_HANDSHAKE blocks with an error',
                    async () =>
                    {
                        let middlewareWasExecuted = false;
                        let serverWarnings        = [];
                        let clientErrors          = [];
                        let abortStatus;

                        let middlewareFunction = async function (middlewareStream)
                        {
                            for await (let { type, allow, block } of middlewareStream)
                            {
                                if (type === TGAction.HANDSHAKE_SC)
                                {
                                    await wait(100);
                                    middlewareWasExecuted = true;
                                    let err               = new Error('AG handshake failed because the server was too lazy');
                                    err.name              = 'TooLazyHandshakeError';
                                    block(err);
                                    continue;
                                }
                                allow();
                            }
                        };
                        server.setMiddleware(server.MIDDLEWARE_HANDSHAKE, middlewareFunction);

                        (async () =>
                        {
                            for await (let { warning } of server.listener('warning'))
                            {
                                serverWarnings.push(warning);
                            }
                        })();

                        client = create({
                            hostname: clientOptions.hostname,
                            port    : PORT_NUMBER
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
                    }
                );

                it(
                    'Should send back default 4008 status code if MIDDLEWARE_HANDSHAKE blocks without providing a status code',
                    async () =>
                    {
                        let middlewareWasExecuted = false;
                        let abortStatus;
                        let abortReason;

                        let middlewareFunction = async function (middlewareStream)
                        {
                            for await (let { type, allow, block } of middlewareStream)
                            {
                                if (type === TGAction.HANDSHAKE_SC)
                                {
                                    await wait(100);
                                    middlewareWasExecuted = true;
                                    let err               = new Error('AG handshake failed because the server was too lazy');
                                    err.name              = 'TooLazyHandshakeError';
                                    block(err);
                                    continue;
                                }
                                allow();
                            }
                        };
                        server.setMiddleware(server.MIDDLEWARE_HANDSHAKE, middlewareFunction);

                        client = create({
                            hostname: clientOptions.hostname,
                            port    : PORT_NUMBER
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
                            'TooLazyHandshakeError: AG handshake failed because the server was too lazy'
                        );
                    }
                );

                it(
                    'Should send back custom status code if MIDDLEWARE_HANDSHAKE blocks by providing a status code',
                    async () =>
                    {
                        let middlewareWasExecuted = false;
                        let abortStatus;
                        let abortReason;

                        let middlewareFunction = async function (middlewareStream)
                        {
                            for await (let { type, allow, block } of middlewareStream)
                            {
                                if (type === TGAction.HANDSHAKE_SC)
                                {
                                    await wait(100);
                                    middlewareWasExecuted = true;
                                    let err: any          = new Error('AG handshake failed because of invalid query auth parameters');
                                    err.name              = 'InvalidAuthQueryHandshakeError';
                                    // Set custom 4501 status code as a property of the error.
                                    // We will treat this code as a fatal authentication failure on the front end.
                                    // A status code of 4500 or higher means that the client shouldn't try to reconnect.
                                    err.statusCode = 4501;
                                    block(err);
                                    continue;
                                }
                                allow();
                            }
                        };
                        server.setMiddleware(server.MIDDLEWARE_HANDSHAKE, middlewareFunction);

                        client = create({
                            hostname: clientOptions.hostname,
                            port    : PORT_NUMBER
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
                            'InvalidAuthQueryHandshakeError: AG handshake failed because of invalid query auth parameters'
                        );
                    }
                );

                it(
                    'Should connect with a delay if allow() is called after a timeout inside the middleware function',
                    async () =>
                    {
                        let createConnectionTime = null;
                        let connectEventTime     = null;
                        let abortStatus;
                        let abortReason;

                        let middlewareFunction = async function (middlewareStream)
                        {
                            for await (let { type, allow } of middlewareStream)
                            {
                                if (type === TGAction.HANDSHAKE_SC)
                                {
                                    await wait(500);
                                }
                                allow();
                            }
                        };
                        server.setMiddleware(server.MIDDLEWARE_HANDSHAKE, middlewareFunction);

                        createConnectionTime = Date.now();
                        client               = create({
                            hostname: clientOptions.hostname,
                            port    : PORT_NUMBER
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
                    }
                );

                it(
                    'Should not be allowed to call req.socket.setAuthToken from inside middleware',
                    async () =>
                    {
                        let didAuthenticationEventTrigger = false;
                        let setAuthTokenError;

                        server.setMiddleware(server.MIDDLEWARE_HANDSHAKE, async function (middlewareStream: any)
                        {
                            for await (let { socket, type, allow, block } of middlewareStream)
                            {
                                if (type === TGAction.HANDSHAKE_SC)
                                {
                                    try
                                    {
                                        await socket.setAuthToken({ username: 'alice' });
                                    }
                                    catch (error)
                                    {
                                        setAuthTokenError = error;
                                    }
                                }
                                allow();
                            }
                        });

                        (async () =>
                        {
                            let event                     = await server.listener('authentication').once();
                            didAuthenticationEventTrigger = true;
                        })();

                        client = create({
                            hostname: clientOptions.hostname,
                            port    : PORT_NUMBER
                        });

                        let event = await client.listener('connect').once();
                        expect(event.isAuthenticated).toEqual(false);
                        expect(client.authState).toEqual(client.UNAUTHENTICATED);
                        expect(client.authToken).toEqual(null);
                        expect(didAuthenticationEventTrigger).toEqual(false);
                        expect(setAuthTokenError).not.toEqual(null);
                        expect(setAuthTokenError.name).toEqual('InvalidActionError');
                    }
                );

                it(
                    'Delaying handshake for one client should not affect other clients',
                    async () =>
                    {
                        let middlewareFunction = async function (middlewareStream)
                        {
                            for await (let action of middlewareStream)
                            {
                                if (action.type === TGAction.HANDSHAKE_SC)
                                {
                                    if (action.socket.request.url.indexOf('?delayMe=true') !== -1)
                                    {
                                        // Long delay.
                                        await wait(5000);
                                        action.allow();
                                        continue;
                                    }
                                }
                                action.allow();
                            }
                        };
                        server.setMiddleware(server.MIDDLEWARE_HANDSHAKE, middlewareFunction);

                        let clientA = create({
                            hostname: clientOptions.hostname,
                            port    : PORT_NUMBER
                        });

                        let clientB = create({
                            hostname: clientOptions.hostname,
                            port    : PORT_NUMBER,
                            query   : {
                                delayMe: true
                            }
                        });

                        let clientAIsConnected = false;
                        let clientBIsConnected = false;

                        (async () =>
                        {
                            await clientA.listener('connect').once();
                            clientAIsConnected = true;
                        })();

                        (async () =>
                        {
                            await clientB.listener('connect').once();
                            clientBIsConnected = true;
                        })();

                        await wait(100);

                        expect(clientAIsConnected).toEqual(true);
                        expect(clientBIsConnected).toEqual(false);

                        clientA.disconnect();
                        clientB.disconnect();
                    }
                );
            });
        });

        describe('MIDDLEWARE_INBOUND', () =>
        {
            describe('INVOKE action', () =>
            {
                it(
                    'Should run INVOKE action in middleware if client invokes an RPC',
                    async () =>
                    {
                        let middlewareWasExecuted = false;
                        let middlewareAction      = null;

                        let middlewareFunction = async function (middlewareStream)
                        {
                            for await (let action of middlewareStream)
                            {
                                if (action.type === TGAction.INVOKE)
                                {
                                    middlewareWasExecuted = true;
                                    middlewareAction      = action;
                                }
                                action.allow();
                            }
                        };
                        server.setMiddleware(server.MIDDLEWARE_INBOUND, middlewareFunction);

                        client = create({
                            hostname: clientOptions.hostname,
                            port    : PORT_NUMBER
                        });

                        let result = await client.invoke('proc', 123);

                        expect(middlewareWasExecuted).toEqual(true);
                        expect(middlewareAction).not.toEqual(null);
                        expect(result).toEqual('success 123');
                    }
                );

                it(
                    'Should send back custom Error if INVOKE action in middleware blocks the client RPC',
                    async () =>
                    {
                        let middlewareWasExecuted = false;
                        let middlewareAction      = null;

                        let middlewareFunction = async function (middlewareStream)
                        {
                            for await (let action of middlewareStream)
                            {
                                if (action.type === TGAction.INVOKE)
                                {
                                    middlewareWasExecuted = true;
                                    middlewareAction      = action;

                                    let customError  = new Error('Invoke action was blocked');
                                    customError.name = 'BlockedInvokeError';
                                    action.block(customError);
                                    continue;
                                }
                                action.allow();
                            }
                        };
                        server.setMiddleware(server.MIDDLEWARE_INBOUND, middlewareFunction);

                        client = create({
                            hostname: clientOptions.hostname,
                            port    : PORT_NUMBER
                        });

                        let result;
                        let error;
                        try
                        {
                            result = await client.invoke('proc', 123);
                        }
                        catch (err)
                        {
                            error = err;
                        }

                        expect(result).toBeUndefined();
                        expect(error).not.toEqual(null);
                        expect(error.name).toEqual('BlockedInvokeError');
                    }
                );
            });

            describe('AUTHENTICATE action', () =>
            {
                it(
                    'Should not run AUTHENTICATE action in middleware if JWT token does not exist',
                    async () =>
                    {
                        let middlewareWasExecuted = false;
                        let middlewareFunction    = async function (middlewareStream)
                        {
                            for await (let { type, allow } of middlewareStream)
                            {
                                if (type === TGAction.AUTHENTICATE)
                                {
                                    middlewareWasExecuted = true;
                                }
                                allow();
                            }
                        };
                        server.setMiddleware(server.MIDDLEWARE_INBOUND, middlewareFunction);

                        client = create({
                            hostname: clientOptions.hostname,
                            port    : PORT_NUMBER
                        });

                        await client.listener('connect').once();
                        expect(middlewareWasExecuted).not.toEqual(true);
                    }
                );

                it(
                    'Should run AUTHENTICATE action in middleware if JWT token exists',
                    async () =>
                    {
                        global.localStorage.setItem('topgunsocket.authToken', validSignedAuthTokenBob);
                        let middlewareWasExecuted = false;

                        let middlewareFunction = async function (middlewareStream)
                        {
                            for await (let { type, allow } of middlewareStream)
                            {
                                if (type === TGAction.AUTHENTICATE)
                                {
                                    middlewareWasExecuted = true;
                                }
                                allow();
                            }
                        };
                        server.setMiddleware(server.MIDDLEWARE_INBOUND, middlewareFunction);

                        client = create({
                            hostname: clientOptions.hostname,
                            port    : PORT_NUMBER
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
                    }
                );
            });

            describe('PUBLISH_IN action', () =>
            {
                it(
                    'Should run PUBLISH_IN action in middleware if client publishes to a channel',
                    async () =>
                    {
                        let middlewareWasExecuted = false;
                        let middlewareAction      = null;

                        let middlewareFunction = async function (middlewareStream)
                        {
                            for await (let action of middlewareStream)
                            {
                                if (action.type === TGAction.PUBLISH_IN)
                                {
                                    middlewareWasExecuted = true;
                                    middlewareAction      = action;
                                }
                                action.allow();
                            }
                        };
                        server.setMiddleware(server.MIDDLEWARE_INBOUND, middlewareFunction);

                        client = create({
                            hostname: clientOptions.hostname,
                            port    : PORT_NUMBER
                        });

                        await client.invokePublish('hello', 'world');

                        expect(middlewareWasExecuted).toEqual(true);
                        expect(middlewareAction).not.toEqual(null);
                        expect(middlewareAction.channel).toEqual('hello');
                        expect(middlewareAction.data).toEqual('world');
                    }
                );

                it(
                    'Should be able to delay and block publish using PUBLISH_IN middleware',
                    async () =>
                    {
                        let middlewareWasExecuted = false;

                        let middlewareFunction = async function (middlewareStream)
                        {
                            for await (let action of middlewareStream)
                            {
                                if (action.type === TGAction.PUBLISH_IN)
                                {
                                    middlewareWasExecuted = true;
                                    let error             = new Error('Blocked by middleware');
                                    error.name            = 'BlockedError';
                                    await wait(50);
                                    action.block(error);
                                    continue;
                                }
                                action.allow();
                            }
                        };
                        server.setMiddleware(server.MIDDLEWARE_INBOUND, middlewareFunction);

                        client = create({
                            hostname: clientOptions.hostname,
                            port    : PORT_NUMBER
                        });

                        let helloChannel = client.subscribe('hello');
                        await helloChannel.listener('subscribe').once();

                        let receivedMessages = [];
                        (async () =>
                        {
                            for await (let data of helloChannel)
                            {
                                receivedMessages.push(data);
                            }
                        })();

                        let error;
                        try
                        {
                            await client.invokePublish('hello', 'world');
                        }
                        catch (err)
                        {
                            error = err;
                        }
                        await wait(100);

                        expect(middlewareWasExecuted).toEqual(true);
                        expect(error).not.toEqual(null);
                        expect(error.name).toEqual('BlockedError');
                        expect(receivedMessages.length).toEqual(0);
                    }
                );

                it(
                    'Delaying PUBLISH_IN action for one client should not affect other clients',
                    async () =>
                    {
                        let middlewareFunction = async function (middlewareStream)
                        {
                            for await (let action of middlewareStream)
                            {
                                if (action.type === TGAction.PUBLISH_IN)
                                {
                                    if (action.socket.request.url.indexOf('?delayMe=true') !== -1)
                                    {
                                        // Long delay.
                                        await wait(5000);
                                        action.allow();
                                        continue;
                                    }
                                }
                                action.allow();
                            }
                        };
                        server.setMiddleware(server.MIDDLEWARE_INBOUND, middlewareFunction);

                        let clientA = create({
                            hostname: clientOptions.hostname,
                            port    : PORT_NUMBER
                        });

                        let clientB = create({
                            hostname: clientOptions.hostname,
                            port    : PORT_NUMBER,
                            query   : {
                                delayMe: true
                            }
                        });

                        let clientC = create({
                            hostname: clientOptions.hostname,
                            port    : PORT_NUMBER
                        });

                        await clientC.listener('connect').once();

                        let receivedMessages = [];
                        (async () =>
                        {
                            for await (let data of clientC.subscribe('foo'))
                            {
                                receivedMessages.push(data);
                            }
                        })();

                        clientA.transmitPublish('foo', 'a1');
                        clientA.transmitPublish('foo', 'a2');

                        clientB.transmitPublish('foo', 'b1');
                        clientB.transmitPublish('foo', 'b2');

                        await wait(100);

                        expect(receivedMessages.length).toEqual(2);
                        expect(receivedMessages[0]).toEqual('a1');
                        expect(receivedMessages[1]).toEqual('a2');

                        clientA.disconnect();
                        clientB.disconnect();
                        clientC.disconnect();
                    }
                );

                it(
                    'Should allow to change message in middleware when client invokePublish',
                    async () =>
                    {
                        let clientMessage      = 'world';
                        let middlewareMessage  = 'intercepted';
                        let middlewareFunction = async function (middlewareStream)
                        {
                            for await (let action of middlewareStream)
                            {
                                if (action.type === TGAction.PUBLISH_IN)
                                {
                                    action.allow({ data: middlewareMessage });
                                }
                                else
                                {
                                    action.allow();
                                }
                            }
                        };

                        server.setMiddleware(server.MIDDLEWARE_INBOUND, middlewareFunction);

                        client = create({
                            hostname: clientOptions.hostname,
                            port    : PORT_NUMBER
                        });

                        let helloChannel = client.subscribe('hello');
                        await helloChannel.listener('subscribe').once();

                        let receivedMessages = [];
                        (async () =>
                        {
                            for await (let data of helloChannel)
                            {
                                receivedMessages.push(data);
                            }
                        })();

                        let error;
                        try
                        {
                            await client.invokePublish('hello', clientMessage);
                        }
                        catch (err)
                        {
                            error = err;
                        }

                        await wait(100);

                        expect(clientMessage).not.toEqual(middlewareMessage);
                        expect(receivedMessages[0]).toEqual(middlewareMessage);
                    }
                );

                it(
                    'Should allow to change message in middleware when client transmitPublish',
                    async () =>
                    {
                        let clientMessage      = 'world';
                        let middlewareMessage  = 'intercepted';
                        let middlewareFunction = async function (middlewareStream)
                        {
                            for await (let action of middlewareStream)
                            {
                                if (action.type === TGAction.PUBLISH_IN)
                                {
                                    action.allow({ data: middlewareMessage });
                                }
                                else
                                {
                                    action.allow();
                                }
                            }
                        };

                        server.setMiddleware(server.MIDDLEWARE_INBOUND, middlewareFunction);

                        client = create({
                            hostname: clientOptions.hostname,
                            port    : PORT_NUMBER
                        });

                        let helloChannel = client.subscribe('hello');
                        await helloChannel.listener('subscribe').once();

                        let receivedMessages = [];
                        (async () =>
                        {
                            for await (let data of helloChannel)
                            {
                                receivedMessages.push(data);
                            }
                        })();

                        let error;
                        try
                        {
                            await client.transmitPublish('hello', clientMessage);
                        }
                        catch (err)
                        {
                            error = err;
                        }

                        await wait(100);

                        expect(clientMessage).not.toEqual(middlewareMessage);
                        expect(receivedMessages[0]).toEqual(middlewareMessage);
                    }
                )
            });

            describe('SUBSCRIBE action', () =>
            {
                it(
                    'Should run SUBSCRIBE action in middleware if client subscribes to a channel',
                    async () =>
                    {
                        let middlewareWasExecuted = false;
                        let middlewareAction      = null;

                        let middlewareFunction = async function (middlewareStream)
                        {
                            for await (let action of middlewareStream)
                            {
                                if (action.type === TGAction.SUBSCRIBE)
                                {
                                    middlewareWasExecuted = true;
                                    middlewareAction      = action;
                                }
                                action.allow();
                            }
                        };
                        server.setMiddleware(server.MIDDLEWARE_INBOUND, middlewareFunction);

                        client = create({
                            hostname: clientOptions.hostname,
                            port    : PORT_NUMBER
                        });

                        await client.subscribe('hello').listener('subscribe').once();

                        expect(middlewareWasExecuted).toEqual(true);
                        expect(middlewareAction).not.toEqual(null);
                        expect(middlewareAction.channel).toEqual('hello');
                    }
                );

                it(
                    'Should maintain pub/sub order if SUBSCRIBE action is delayed in middleware even if client starts out in disconnected state',
                    async () =>
                    {
                        let middlewareActions = [];

                        let middlewareFunction = async function (middlewareStream)
                        {
                            for await (let action of middlewareStream)
                            {
                                middlewareActions.push(action);
                                if (action.type === TGAction.SUBSCRIBE)
                                {
                                    await wait(100);
                                    action.allow();
                                    continue;
                                }
                                action.allow();
                            }
                        };
                        server.setMiddleware(server.MIDDLEWARE_INBOUND, middlewareFunction);

                        client = create({
                            hostname   : clientOptions.hostname,
                            port       : PORT_NUMBER,
                            autoConnect: false
                        });

                        let receivedMessage;

                        let fooChannel = client.subscribe('foo');
                        client.transmitPublish('foo', 'bar');

                        for await (let data of fooChannel)
                        {
                            receivedMessage = data;
                            break;
                        }

                        expect(receivedMessage).toEqual('bar');
                        expect(middlewareActions.length).toEqual(2);
                        expect(middlewareActions[0].type).toEqual(TGAction.SUBSCRIBE);
                        expect(middlewareActions[0].channel).toEqual('foo');
                        expect(middlewareActions[1].type).toEqual(TGAction.PUBLISH_IN);
                        expect(middlewareActions[1].channel).toEqual('foo');
                    }
                );
            });
        });

        describe('MIDDLEWARE_OUTBOUND', () =>
        {
            describe('PUBLISH_OUT action', () =>
            {
                it(
                    'Should run PUBLISH_OUT action in middleware if client publishes to a channel',
                    async () =>
                    {
                        let middlewareWasExecuted = false;
                        let middlewareAction      = null;

                        let middlewareFunction = async function (middlewareStream)
                        {
                            for await (let action of middlewareStream)
                            {
                                if (action.type === TGAction.PUBLISH_OUT)
                                {
                                    middlewareWasExecuted = true;
                                    middlewareAction      = action;
                                }
                                action.allow();
                            }
                        };
                        server.setMiddleware(server.MIDDLEWARE_OUTBOUND, middlewareFunction);

                        client = create({
                            hostname: clientOptions.hostname,
                            port    : PORT_NUMBER
                        });

                        await client.subscribe('hello').listener('subscribe').once();
                        await client.invokePublish('hello', 123);

                        expect(middlewareWasExecuted).toEqual(true);
                        expect(middlewareAction).not.toEqual(null);
                        expect(middlewareAction.channel).toEqual('hello');
                        expect(middlewareAction.data).toEqual(123);
                    }
                );
            });
        });
    });*/
});
