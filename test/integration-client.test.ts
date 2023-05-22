import * as localStorage from 'localStorage';
import { create } from '../src/client';
import { listen } from '../src/server';
import { wait } from '../src/utils/wait';

// Add to the global scope like in browser.
global.localStorage = localStorage;

const PORT_NUMBER = 8009;

let clientOptions;
let serverOptions;

let allowedUsers = {
    bob  : true,
    kate : true,
    alice: true
};

let server, client;
let validSignedAuthTokenBob  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VybmFtZSI6ImJvYiIsImV4cCI6MzE2Mzc1ODk3ODIxNTQ4NywiaWF0IjoxNTAyNzQ3NzQ2fQ.GLf_jqi_qUSCRahxe2D2I9kD8iVIs0d4xTbiZMRiQq4';
let validSignedAuthTokenKate = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VybmFtZSI6ImthdGUiLCJleHAiOjMxNjM3NTg5NzgyMTU0ODcsImlhdCI6MTUwMjc0Nzc5NX0.Yfb63XvDt9Wk0wHSDJ3t7Qb1F0oUVUaM5_JKxIE2kyw';
let invalidSignedAuthToken   = 'fakebGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.fakec2VybmFtZSI6ImJvYiIsImlhdCI6MTUwMjYyNTIxMywiZXhwIjoxNTAyNzExNjEzfQ.fakemYcOOjM9bzmS4UYRvlWSk_lm3WGHvclmFjLbyOk';

const TOKEN_EXPIRY_IN_SECONDS = 60 * 60 * 24 * 366 * 5000;

function connectionHandler(socket)
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
            setTimeout(() =>
            {
                rpc.end();
            }, 1000);
        }
    }

    handlePerformTask();
}

beforeEach(async () =>
{
    serverOptions = {
        authKey   : 'testkey',
        ackTimeout: 200
    };

    server = listen(PORT_NUMBER, serverOptions);

    async function handleServerConnection()
    {
        for await (let { socket } of server.listener('connection'))
        {
            connectionHandler(socket);
        }
    }

    handleServerConnection();

    server.addMiddleware(server.MIDDLEWARE_AUTHENTICATE, async function (req)
    {
        if (req.authToken.username === 'alice')
        {
            let err  = new Error('Blocked by MIDDLEWARE_AUTHENTICATE');
            err.name = 'AuthenticateMiddlewareError';
            throw err;
        }
    });

    clientOptions = {
        hostname  : '127.0.0.1',
        port      : PORT_NUMBER,
        ackTimeout: 200
    };

    await server.listener('ready').once();
});

afterEach(async () =>
{
    let cleanupTasks = [];
    global.localStorage.removeItem('asyngular.authToken');
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

describe('Integration tests', () =>
{
    describe('Creation', () =>
    {

        it(
            'Should automatically connect socket on creation by default',
            async () =>
            {
                clientOptions = {
                    hostname: '127.0.0.1',
                    port    : PORT_NUMBER
                };

                client = create(clientOptions);

                expect(client.state).toEqual(client.CONNECTING);
            }
        );

        it(
            'Should not automatically connect socket if autoConnect is set to false',
            async () =>
            {
                clientOptions = {
                    hostname   : '127.0.0.1',
                    port       : PORT_NUMBER,
                    autoConnect: false
                };

                client = create(clientOptions);

                expect(client.state).toEqual(client.CLOSED);
            }
        );
    });

    describe('Errors', () =>
    {
        it(
            'Should be able to emit the error event locally on the socket',
            async () =>
            {
                client  = create(clientOptions);
                let err = null;

                (async () =>
                {
                    for await (let { error } of client.listener('error'))
                    {
                        err = error;
                    }
                })();

                (async () =>
                {
                    for await (let status of client.listener('connect'))
                    {
                        let error  = new Error('Custom error');
                        error.name = 'CustomError';
                        client.emit('error', { error });
                    }
                })();

                await wait(100);

                expect(err).not.toEqual(null);
                expect(err.name).toEqual('CustomError');
            }
        );
    });

    describe('Authentication', () =>
    {
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
                global.localStorage.setItem('asyngular.authToken', validSignedAuthTokenBob);
                client = create(clientOptions);

                let event = await client.listener('connect').once();
                expect(client.authState).toEqual('authenticated');
                expect(event.isAuthenticated).toEqual(true);
                expect(event.authError === undefined).toEqual(true);
            }
        );

        it('Should send back error if JWT is invalid during handshake', async () =>
        {
            global.localStorage.setItem('asyngular.authToken', validSignedAuthTokenBob);
            client = create(clientOptions);

            let event = await client.listener('connect').once();
            expect(event).not.toEqual(null);
            expect(event.isAuthenticated).toEqual(true);
            expect(event.authError).toEqual(null);

            expect(client.signedAuthToken).not.toEqual(null);
            expect(client.authToken).not.toEqual(null);

            // Change the setAuthKey to invalidate the current token.
            await client.invoke('setAuthKey', 'differentAuthKey');

            client.disconnect();
            client.connect();

            event = await client.listener('connect').once();

            expect(event.isAuthenticated).toEqual(false);
            expect(event.authError).not.toEqual(null);
            expect(event.authError.name).toEqual('AuthTokenInvalidError');

            // When authentication fails, the auth token properties on the client
            // socket should be set to null; that way it's not going to keep
            // throwing the same error every time the socket tries to connect.
            expect(client.signedAuthToken).toEqual(null);
            expect(client.authToken).toEqual(null);

            // Set authKey back to what it was.
            await client.invoke('setAuthKey', serverOptions.authKey);
        });

        it('Should allow switching between users', async () =>
        {
            global.localStorage.setItem('asyngular.authToken', validSignedAuthTokenBob);
            client                       = create(clientOptions);
            let authenticateTriggered    = false;
            let authStateChangeTriggered = false;

            await client.listener('connect').once();

            expect(client.authToken).not.toEqual(null);
            expect(client.authToken.username).toEqual('bob');

            client.invoke('login', { username: 'alice' });

            (async () =>
            {
                await client.listener('authenticate').once();
                authenticateTriggered = true;
                expect(client.authState).toEqual('authenticated');
                expect(client.authToken).not.toEqual(null);
                expect(client.authToken.username).toEqual('alice');
            })();

            (async () =>
            {
                await client.listener('authStateChange').once();
                authStateChangeTriggered = true;
            })();

            await wait(100);

            expect(authenticateTriggered).toEqual(true);
            expect(authStateChangeTriggered).toEqual(false);
        });

        it(
            'If token engine signing is synchronous, authentication can be captured using the authenticate event',
            async () =>
            {
                let port         = 8509;
                let customServer = listen(port, {
                    authKey      : serverOptions.authKey,
                    authSignAsync: false
                });

                (async () =>
                {
                    let { socket } = await customServer.listener('connection').once();
                    connectionHandler(socket);
                })();

                await customServer.listener('ready').once();

                client = create({
                    hostname: clientOptions.hostname,
                    port    : port
                });

                await client.listener('connect').once();

                await client.invoke('login', { username: 'bob' });
                await client.listener('authenticate').once();

                expect(client.authState).toEqual('authenticated');
                expect(client.authToken).not.toEqual(null);
                expect(client.authToken.username).toEqual('bob');

                customServer.httpServer.close();
                await customServer.close();
            }
        );

        it(
            'If token engine signing is asynchronous, authentication can be captured using the authenticate event',
            async () =>
            {
                let port         = 8510;
                let customServer = listen(port, {
                    authKey      : serverOptions.authKey,
                    authSignAsync: true
                });

                (async () =>
                {
                    let { socket } = await customServer.listener('connection').once();
                    connectionHandler(socket);
                })();

                await customServer.listener('ready').once();

                client = create({
                    hostname: clientOptions.hostname,
                    port    : port
                });

                await client.listener('connect').once();

                client.invoke('login', { username: 'bob' });

                await client.listener('authenticate').once();

                expect(client.authState).toEqual('authenticated');
                expect(client.authToken).not.toEqual(null);
                expect(client.authToken.username).toEqual('bob');

                customServer.httpServer.close();
                await customServer.close();
            }
        );

        it(
            'If token verification is synchronous, authentication can be captured using the authenticate event',
            async () =>
            {
                let port           = 8511;
                const customServer = listen(port, {
                    authKey        : serverOptions.authKey,
                    authVerifyAsync: false
                });

                (async () =>
                {
                    let { socket } = await customServer.listener('connection').once();
                    connectionHandler(socket);
                })();

                await customServer.listener('ready').once();

                client = create({
                    hostname: clientOptions.hostname,
                    port    : port
                });

                await client.listener('connect').once();

                await Promise.all([
                    (async () =>
                    {
                        await client.invoke('login', { username: 'bob' });
                        await client.listener('authenticate').once();
                        client.disconnect();
                    })(),
                    (async () =>
                    {
                        await client.listener('authenticate').once();
                        await client.listener('disconnect').once();
                        client.connect();
                        let event = await client.listener('connect').once();

                        expect(event.isAuthenticated).toEqual(true);
                        expect(client.authToken).not.toEqual(null);
                        expect(client.authToken.username).toEqual('bob');
                    })()
                ]);

                customServer.httpServer.close();
                await customServer.close();
            }
        );

        it(
            'Should start out in pending authState and switch to unauthenticated if no token exists',
            async () =>
            {
                client = create(clientOptions);
                expect(client.authState).toEqual('unauthenticated');

                (async () =>
                {
                    let status = await client.listener('authStateChange').once();
                    throw new Error('authState should not change after connecting without a token');
                })();

                await wait(1000);
            }
        );

        it(
            'Should deal with auth engine errors related to saveToken function',
            async () =>
            {
                global.localStorage.setItem('asyngular.authToken', validSignedAuthTokenBob);
                client = create(clientOptions);

                let caughtError;

                (async () =>
                {
                    for await (let { error } of client.listener('error'))
                    {
                        caughtError = error;
                    }
                })();

                await client.listener('connect').once();

                let oldSaveTokenFunction = client.auth.saveToken;
                client.auth.saveToken    = function (tokenName, tokenValue, options)
                {
                    let err  = new Error('Failed to save token');
                    err.name = 'FailedToSaveTokenError';
                    return Promise.reject(err);
                };
                expect(client.authToken).not.toEqual(null);
                expect(client.authToken.username).toEqual('bob');

                let authStatus = await client.authenticate(validSignedAuthTokenKate);

                expect(authStatus).not.toEqual(null);
                // The error here comes from the client auth engine and does not prevent the
                // authentication from taking place, it only prevents the token from being
                // stored correctly on the client.
                expect(authStatus.isAuthenticated).toEqual(true);
                // authError should be null because the error comes from the client-side auth engine
                // whereas authError is for server-side errors (e.g. JWT errors).
                expect(authStatus.authError).toEqual(null);

                expect(client.authToken).not.toEqual(null);
                expect(client.authToken.username).toEqual('kate');

                await wait(10);

                expect(caughtError).not.toEqual(null);
                expect(caughtError.name).toEqual('FailedToSaveTokenError');
                client.auth.saveToken = oldSaveTokenFunction;
            }
        );

        it(
            'Should gracefully handle authenticate abortion due to disconnection',
            async () =>
            {
                client = create(clientOptions);

                await client.listener('connect').once();

                let authenticatePromise = await client.authenticate(validSignedAuthTokenBob);
                client.disconnect();

                try
                {
                    await authenticatePromise;
                }
                catch (err)
                {
                    expect(err).not.toEqual(null);
                    expect(err.name).toEqual('BadConnectionError');
                    expect(client.authState).toEqual('unauthenticated');
                }
            }
        );

        it(
            'Should go through the correct sequence of authentication state changes when dealing with disconnections; part 1',
            async () =>
            {
                client = create(clientOptions);

                let expectedAuthStateChanges = [
                    'unauthenticated->authenticated'
                ];
                let authStateChanges         = [];

                (async () =>
                {
                    for await (const status of client.listener('authStateChange'))
                    {
                        authStateChanges.push(status.oldAuthState + '->' + status.newAuthState);
                    }
                })();

                expect(client.authState).toEqual('unauthenticated');

                await client.listener('connect').once();
                expect(client.authState).toEqual('unauthenticated');

                (async () =>
                {
                    await client.invoke('login', { username: 'bob' });
                    await client.listener('authenticate').once();
                    client.disconnect();
                })();

                expect(client.authState).toEqual('unauthenticated');

                let { signedAuthToken, authToken } = await client.listener('authenticate').once();

                expect(signedAuthToken).not.toEqual(null);
                expect(authToken).not.toEqual(null);

                expect(client.authState).toEqual('authenticated');

                await client.listener('disconnect').once();

                // In case of disconnection, the socket maintains the last known auth state.
                expect(client.authState).toEqual('authenticated');

                await client.authenticate(signedAuthToken);

                expect(client.authState).toEqual('authenticated');
                expect(JSON.stringify(authStateChanges)).toEqual(JSON.stringify(expectedAuthStateChanges));
                client.closeListener('authStateChange');
            }
        );

        it(
            'Should go through the correct sequence of authentication state changes when dealing with disconnections; part 2',
            async () =>
            {
                global.localStorage.setItem('asyngular.authToken', validSignedAuthTokenBob);
                client = create(clientOptions);

                let expectedAuthStateChanges = [
                    'unauthenticated->authenticated',
                    'authenticated->unauthenticated',
                    'unauthenticated->authenticated',
                    'authenticated->unauthenticated'
                ];
                let authStateChanges         = [];

                (async () =>
                {
                    for await (const status of client.listener('authStateChange'))
                    {
                        authStateChanges.push(status.oldAuthState + '->' + status.newAuthState);
                    }
                })();

                expect(client.authState).toEqual('unauthenticated');

                await client.listener('connect').once();

                expect(client.authState).toEqual('authenticated');
                client.deauthenticate();
                expect(client.authState).toEqual('unauthenticated');
                let authenticatePromise = client.authenticate(validSignedAuthTokenBob);
                expect(client.authState).toEqual('unauthenticated');

                await authenticatePromise;

                expect(client.authState).toEqual('authenticated');

                client.disconnect();

                expect(client.authState).toEqual('authenticated');
                await client.deauthenticate();
                expect(client.authState).toEqual('unauthenticated');

                expect(JSON.stringify(authStateChanges)).toEqual(JSON.stringify(expectedAuthStateChanges));
            }
        );

        it(
            'Should go through the correct sequence of authentication state changes when dealing with disconnections; part 3',
            async () =>
            {
                global.localStorage.setItem('asyngular.authToken', validSignedAuthTokenBob);
                client = create(clientOptions);

                let expectedAuthStateChanges = [
                    'unauthenticated->authenticated',
                    'authenticated->unauthenticated'
                ];
                let authStateChanges         = [];

                (async () =>
                {
                    for await (let status of client.listener('authStateChange'))
                    {
                        authStateChanges.push(status.oldAuthState + '->' + status.newAuthState);
                    }
                })();

                expect(client.authState).toEqual('unauthenticated');

                await client.listener('connect').once();

                expect(client.authState).toEqual('authenticated');
                let authenticatePromise = client.authenticate(invalidSignedAuthToken);
                expect(client.authState).toEqual('authenticated');

                try
                {
                    await authenticatePromise;
                }
                catch (err)
                {
                    expect(err).not.toEqual(null);
                    expect(err.name).toEqual('AuthTokenInvalidError');
                    expect(client.authState).toEqual('unauthenticated');
                    expect(JSON.stringify(authStateChanges)).toEqual(JSON.stringify(expectedAuthStateChanges));
                }
            }
        );

        it(
            'Should go through the correct sequence of authentication state changes when authenticating as a user while already authenticated as another user',
            async () =>
            {
                global.localStorage.setItem('asyngular.authToken', validSignedAuthTokenBob);
                client = create(clientOptions);

                let expectedAuthStateChanges = [
                    'unauthenticated->authenticated'
                ];
                let authStateChanges         = [];

                (async () =>
                {
                    for await (let status of client.listener('authStateChange'))
                    {
                        authStateChanges.push(status.oldAuthState + '->' + status.newAuthState);
                    }
                })();

                let expectedAuthTokenChanges = [
                    validSignedAuthTokenBob,
                    validSignedAuthTokenKate
                ];
                let authTokenChanges         = [];

                (async () =>
                {
                    for await (let event of client.listener('authenticate'))
                    {
                        authTokenChanges.push(client.signedAuthToken);
                    }
                })();

                (async () =>
                {
                    for await (let event of client.listener('deauthenticate'))
                    {
                        authTokenChanges.push(client.signedAuthToken);
                    }
                })();

                expect(client.authState).toEqual('unauthenticated');

                await client.listener('connect').once();

                expect(client.authState).toEqual('authenticated');
                expect(client.authToken.username).toEqual('bob');
                let authenticatePromise = client.authenticate(validSignedAuthTokenKate);

                expect(client.authState).toEqual('authenticated');

                await authenticatePromise;

                expect(client.authState).toEqual('authenticated');
                expect(client.authToken.username).toEqual('kate');
                expect(JSON.stringify(authStateChanges)).toEqual(JSON.stringify(expectedAuthStateChanges));
                expect(JSON.stringify(authTokenChanges)).toEqual(JSON.stringify(expectedAuthTokenChanges));
            }
        );

        it(
            'Should wait for socket to be authenticated before subscribing to waitForAuth channel',
            async () =>
            {
                client = create(clientOptions);

                let privateChannel = client.subscribe('priv', { waitForAuth: true });
                expect(privateChannel.state).toEqual('pending');

                await client.listener('connect').once();
                expect(privateChannel.state).toEqual('pending');

                client.invoke('login', { username: 'bob' });
                await client.listener('subscribe').once();
                expect(privateChannel.state).toEqual('subscribed');

                client.disconnect();
                expect(privateChannel.state).toEqual('pending');

                client.authenticate(validSignedAuthTokenBob);
                await client.listener('subscribe').once();
                expect(privateChannel.state).toEqual('subscribed');
            }
        );

        it(
            'Subscriptions (including those with waitForAuth option) should have priority over the authenticate action',
            async () =>
            {
                global.localStorage.setItem('asyngular.authToken', validSignedAuthTokenBob);
                client = create(clientOptions);

                let expectedAuthStateChanges = [
                    'unauthenticated->authenticated',
                    'authenticated->unauthenticated'
                ];
                let initialSignedAuthToken;
                let authStateChanges         = [];

                (async () =>
                {
                    for await (let status of client.listener('authStateChange'))
                    {
                        authStateChanges.push(status.oldAuthState + '->' + status.newAuthState);
                    }
                })();

                (async () =>
                {
                    let error = null;
                    try
                    {
                        await client.authenticate(invalidSignedAuthToken);
                    }
                    catch (err)
                    {
                        error = err;
                    }
                    expect(error).not.toEqual(null);
                    expect(error.name).toEqual('AuthTokenInvalidError');
                })();

                let privateChannel = client.subscribe('priv', { waitForAuth: true });
                expect(privateChannel.state).toEqual('pending');

                (async () =>
                {
                    let event              = await client.listener('connect').once();
                    initialSignedAuthToken = client.signedAuthToken;
                    expect(event.isAuthenticated).toEqual(true);
                    expect(privateChannel.state).toEqual('pending');

                    await Promise.race([
                        (async () =>
                        {
                            let err = await privateChannel.listener('subscribeFail').once();
                            // This shouldn't happen because the subscription should be
                            // processed before the authenticate() call with the invalid token fails.
                            throw new Error('Failed to subscribe to channel: ' + err.message);
                        })(),
                        (async () =>
                        {
                            await privateChannel.listener('subscribe').once();
                            expect(privateChannel.state).toEqual('subscribed');
                        })()
                    ]);
                })();

                (async () =>
                {
                    // The subscription already went through so it should still be subscribed.
                    let { oldSignedAuthToken, oldAuthToken } = await client.listener('deauthenticate').once();
                    // The subscription already went through so it should still be subscribed.
                    expect(privateChannel.state).toEqual('subscribed');
                    expect(client.authState).toEqual('unauthenticated');
                    expect(client.authToken).toEqual(null);

                    expect(oldAuthToken).not.toEqual(null);
                    expect(oldAuthToken.username).toEqual('bob');
                    expect(oldSignedAuthToken).toEqual(initialSignedAuthToken);

                    let privateChannel2 = client.subscribe('priv2', { waitForAuth: true });

                    await privateChannel2.listener('subscribe').once();

                    // This line should not execute.
                    throw new Error('Should not subscribe because the socket is not authenticated');
                })();

                await wait(1000);
                client.closeListener('authStateChange');
                expect(JSON.stringify(authStateChanges)).toEqual(JSON.stringify(expectedAuthStateChanges));
            }
        );

        it(
            'Should trigger the close event if the socket disconnects in the middle of the handshake phase',
            async () =>
            {
                client          = create(clientOptions);
                let aborted     = false;
                let diconnected = false;
                let closed      = false;

                (async () =>
                {
                    await client.listener('connectAbort').once();
                    aborted = true;
                })();

                (async () =>
                {
                    await client.listener('disconnect').once();
                    diconnected = true;
                })();

                (async () =>
                {
                    await client.listener('close').once();
                    closed = true;
                })();

                client.disconnect();

                await wait(300);

                expect(aborted).toEqual(true);
                expect(diconnected).toEqual(false);
                expect(closed).toEqual(true);
            }
        );

        it(
            'Should trigger the close event if the socket disconnects after the handshake phase',
            async () =>
            {
                client          = create(clientOptions);
                let aborted     = false;
                let diconnected = false;
                let closed      = false;

                (async () =>
                {
                    await client.listener('connectAbort').once();
                    aborted = true;
                })();

                (async () =>
                {
                    await client.listener('disconnect').once();
                    diconnected = true;
                })();

                (async () =>
                {
                    await client.listener('close').once();
                    closed = true;
                })();

                (async () =>
                {
                    for await (let event of client.listener('connect'))
                    {
                        client.disconnect();
                    }
                })();

                await wait(300);

                expect(aborted).toEqual(false);
                expect(diconnected).toEqual(true);
                expect(closed).toEqual(true);
            }
        );
    });

    describe('Emitting remote events', () =>
    {
        it(
            'Should not throw error on socket if ackTimeout elapses before response to event is sent back',
            async () =>
            {
                client = create(clientOptions);

                let caughtError;
                let clientError;

                (async () =>
                {
                    for await (let { error } of client.listener('error'))
                    {
                        clientError = error;
                    }
                })();

                let responseError;

                for await (let event of client.listener('connect'))
                {
                    try
                    {
                        await client.invoke('performTask', 123);
                    }
                    catch (err)
                    {
                        responseError = err;
                    }
                    await wait(250);
                    try
                    {
                        client.disconnect();
                    }
                    catch (err)
                    {
                        caughtError = err;
                    }
                    break;
                }

                expect(responseError).not.toEqual(null);
                expect(caughtError).toEqual(null);
            }
        );
    });

    describe('Reconnecting socket', () =>
    {
        it('Should disconnect socket with code 1000 and reconnect', async () =>
        {
            client = create(clientOptions);

            await client.listener('connect').once();

            let disconnectCode;
            let disconnectReason;

            (async () =>
            {
                for await (let event of client.listener('disconnect'))
                {
                    disconnectCode   = event.code;
                    disconnectReason = event.reason;
                }
            })();

            client.reconnect();
            await client.listener('connect').once();

            expect(disconnectCode).toEqual(1000);
            expect(disconnectReason).toEqual(undefined);
        });

        it(
            'Should disconnect socket with custom code and data when socket.reconnect() is called with arguments',
            async () =>
            {
                client = create(clientOptions);

                await client.listener('connect').once();

                let disconnectCode;
                let disconnectReason;

                (async () =>
                {
                    let event        = await client.listener('disconnect').once();
                    disconnectCode   = event.code;
                    disconnectReason = event.reason;
                })();

                client.reconnect(1000, 'About to reconnect');
                await client.listener('connect').once();

                expect(disconnectCode).toEqual(1000);
                expect(disconnectReason).toEqual('About to reconnect');
            }
        );
    });

    describe('Order of events', () =>
    {
        it(
            'Should trigger unsubscribe event on channel before disconnect event',
            async () =>
            {
                client              = create(clientOptions);
                let hasUnsubscribed = false;

                let fooChannel = client.subscribe('foo');

                (async () =>
                {
                    for await (let event of fooChannel.listener('subscribe'))
                    {
                        await wait(100);
                        client.disconnect();
                    }
                })();

                (async () =>
                {
                    for await (let event of fooChannel.listener('unsubscribe'))
                    {
                        hasUnsubscribed = true;
                    }
                })();

                await client.listener('disconnect').once();
                expect(hasUnsubscribed).toEqual(true);
            }
        );

        it(
            'Should not invoke subscribeFail event if connection is aborted',
            async () =>
            {
                client                    = create(clientOptions);
                let hasSubscribeFailed    = false;
                let gotBadConnectionError = false;
                let wasConnected          = false;

                (async () =>
                {
                    for await (let event of client.listener('connect'))
                    {
                        wasConnected = true;
                        (async () =>
                        {
                            try
                            {
                                await client.invoke('someEvent', 123);
                            }
                            catch (err)
                            {
                                if (err.name === 'BadConnectionError')
                                {
                                    gotBadConnectionError = true;
                                }
                            }
                        })();

                        let fooChannel = client.subscribe('foo');
                        (async () =>
                        {
                            for await (let event of fooChannel.listener('subscribeFail'))
                            {
                                hasSubscribeFailed = true;
                            }
                        })();

                        (async () =>
                        {
                            await wait(0);
                            client.disconnect();
                        })();
                    }
                })();

                await client.listener('close').once();
                await wait(100);
                expect(wasConnected).toEqual(true);
                expect(gotBadConnectionError).toEqual(true);
                expect(hasSubscribeFailed).toEqual(false);
            }
        );

        it(
            'Should resolve invoke Promise with BadConnectionError after triggering the disconnect event',
            async () =>
            {
                client          = create(clientOptions);
                let messageList = [];

                (async () =>
                {
                    try
                    {
                        await client.invoke('someEvent', 123);
                    }
                    catch (err)
                    {
                        messageList.push({
                            type : 'error',
                            error: err
                        });
                    }
                })();

                (async () =>
                {
                    for await (let event of client.listener('disconnect'))
                    {
                        messageList.push({
                            type  : 'disconnect',
                            code  : event.code,
                            reason: event.reason
                        });
                    }
                })();

                await client.listener('connect').once();
                client.disconnect();
                await wait(200);
                expect(messageList.length).toEqual(2);
                expect(messageList[0].type).toEqual('disconnect');
                expect(messageList[1].type).toEqual('error');
                expect(messageList[1].error.name).toEqual('BadConnectionError');
            }
        );

        it(
            'Should reconnect if transmit is called on a disconnected socket',
            async () =>
            {
                let fooReceiverTriggered = false;

                (async () =>
                {
                    for await (let { socket } of server.listener('connection'))
                    {
                        (async () =>
                        {
                            for await (let data of socket.receiver('foo'))
                            {
                                fooReceiverTriggered = true;
                            }
                        })();
                    }
                })();

                client = create(clientOptions);

                let clientError;

                (async () =>
                {
                    for await (let { error } of client.listener('error'))
                    {
                        clientError = error;
                    }
                })();

                let eventList = [];

                (async () =>
                {
                    for await (let event of client.listener('connecting'))
                    {
                        eventList.push('connecting');
                    }
                })();

                (async () =>
                {
                    for await (let event of client.listener('connect'))
                    {
                        eventList.push('connect');
                    }
                })();

                (async () =>
                {
                    for await (let event of client.listener('disconnect'))
                    {
                        eventList.push('disconnect');
                    }
                })();

                (async () =>
                {
                    for await (let event of client.listener('close'))
                    {
                        eventList.push('close');
                    }
                })();

                (async () =>
                {
                    for await (let event of client.listener('connectAbort'))
                    {
                        eventList.push('connectAbort');
                    }
                })();

                (async () =>
                {
                    await client.listener('connect').once();
                    client.disconnect();
                    client.transmit('foo', 123);
                })();

                await wait(1000);

                let expectedEventList = ['connect', 'disconnect', 'close', 'connecting', 'connect'];
                expect(JSON.stringify(eventList)).toEqual(JSON.stringify(expectedEventList));
                expect(fooReceiverTriggered).toEqual(true);
            }
        );

        it(
            'Should correctly handle multiple successive connect and disconnect calls',
            async () =>
            {
                client = create(clientOptions);

                let eventList = [];

                let clientError;
                (async () =>
                {
                    for await (let { error } of client.listener('error'))
                    {
                        clientError = error;
                    }
                })();

                (async () =>
                {
                    for await (let event of client.listener('connecting'))
                    {
                        eventList.push({
                            event: 'connecting'
                        });
                    }
                })();

                (async () =>
                {
                    for await (let event of client.listener('connect'))
                    {
                        eventList.push({
                            event: 'connect'
                        });
                    }
                })();

                (async () =>
                {
                    for await (let event of client.listener('connectAbort'))
                    {
                        eventList.push({
                            event : 'connectAbort',
                            code  : event.code,
                            reason: event.reason
                        });
                    }
                })();

                (async () =>
                {
                    for await (let event of client.listener('disconnect'))
                    {
                        eventList.push({
                            event : 'disconnect',
                            code  : event.code,
                            reason: event.reason
                        });
                    }
                })();

                (async () =>
                {
                    for await (let event of client.listener('close'))
                    {
                        eventList.push({
                            event : 'close',
                            code  : event.code,
                            reason: event.reason
                        });
                    }
                })();

                client.disconnect(1000, 'One');
                client.connect();
                client.disconnect(4444, 'Two');

                (async () =>
                {
                    await client.listener('connect').once();
                    client.disconnect(4455, 'Three');
                })();

                client.connect();

                await wait(200);

                let expectedEventList = [
                    {
                        event : 'connectAbort',
                        code  : 1000,
                        reason: 'One'
                    },
                    {
                        event : 'close',
                        code  : 1000,
                        reason: 'One'
                    },
                    {
                        event: 'connecting'
                    },
                    {
                        event : 'connectAbort',
                        code  : 4444,
                        reason: 'Two'
                    },
                    {
                        event : 'close',
                        code  : 4444,
                        reason: 'Two'
                    },
                    {
                        event: 'connecting'
                    },
                    {
                        event: 'connect'
                    },
                    {
                        event : 'disconnect',
                        code  : 4455,
                        reason: 'Three'
                    },
                    {
                        event : 'close',
                        code  : 4455,
                        reason: 'Three'
                    },
                ];
                expect(JSON.stringify(eventList)).toEqual(JSON.stringify(expectedEventList));
            }
        );
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

    describe('Utilities', () =>
    {
        it('Can encode a string to base64 and then decode it back to utf8', done =>
        {
            client            = create(clientOptions);
            let encodedString = client.encodeBase64('This is a string');
            expect(encodedString).toEqual('VGhpcyBpcyBhIHN0cmluZw==');
            let decodedString = client.decodeBase64(encodedString);
            expect(decodedString).toEqual('This is a string');
            done();
        });
    });
});
