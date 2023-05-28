import * as localStorage from 'localStorage';
import { create, TGClientSocket, TGSocketClientOptions } from '../../src/client';
import { wait } from '../../src/utils/wait';
import { listen, TGSocketServer, TGSocketServerOptions } from '../../src/server';
import {
    connectionHandler, handleServerConnection,
    invalidSignedAuthToken,
    validSignedAuthTokenBob,
    validSignedAuthTokenKate
} from './utils';
import { cleanupTasks } from '../cleanup-tasks';

// Add to the global scope like in browser.
global.localStorage = localStorage;

const PORT_NUMBER = 10;

let client: TGClientSocket,
    server: TGSocketServer,
    clientOptions: TGSocketClientOptions,
    serverOptions: TGSocketServerOptions;

beforeEach(async () =>
{
    serverOptions = {
        ackTimeout: 200,
        authKey   : 'testkey',
    };
    clientOptions = {
        hostname  : '127.0.0.1',
        port      : PORT_NUMBER,
        ackTimeout: 200
    };

    server = listen(PORT_NUMBER, serverOptions);

    handleServerConnection(server);

    server.addMiddleware(server.MIDDLEWARE_AUTHENTICATE, async req =>
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

afterEach(async () =>
{
    await new Promise<void>(resolve => setTimeout(() => resolve(), 2000));
    await cleanupTasks(client, server);
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
            global.localStorage.setItem('topgunsocket.authToken', validSignedAuthTokenBob);
            client = create(clientOptions);

            let event = await client.listener('connect').once();
            expect(client.authState).toEqual('authenticated');
            expect(event.isAuthenticated).toEqual(true);
            expect(event.authError === undefined).toEqual(true);
        }
    );

    it('Should send back error if JWT is invalid during handshake', async () =>
    {
        global.localStorage.setItem('topgunsocket.authToken', validSignedAuthTokenBob);
        client = create(clientOptions);

        let event = await client.listener('connect').once();
        expect(event).not.toEqual(null);
        expect(event.isAuthenticated).toEqual(true);
        expect(event.authError).toBeUndefined();

        expect(client.signedAuthToken).not.toEqual(null);
        expect(client.authToken).not.toEqual(null);

        // Change the setAuthKey to invalidate the current token.
        await client.invoke('setAuthKey', 'differentAuthKey');

        client.disconnect();
        client.connect();

        event = await client.listener('connect').once();

        expect(event.isAuthenticated).toEqual(false);
        expect(event.authError).not.toEqual(null);
        expect(event.authError.name).toEqual('AuthTokenError');

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
        global.localStorage.setItem('topgunsocket.authToken', validSignedAuthTokenBob);
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
                connectionHandler(socket, customServer);
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
                connectionHandler(socket, customServer);
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
                connectionHandler(socket, customServer);
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
            global.localStorage.setItem('topgunsocket.authToken', validSignedAuthTokenBob);
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
            client.auth.saveToken    = (tokenName: string, tokenValue: string) =>
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
            global.localStorage.setItem('topgunsocket.authToken', validSignedAuthTokenBob);
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
            global.localStorage.setItem('topgunsocket.authToken', validSignedAuthTokenBob);
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
                expect(err.name).toEqual('AuthTokenError');
                expect(client.authState).toEqual('unauthenticated');
                expect(JSON.stringify(authStateChanges)).toEqual(JSON.stringify(expectedAuthStateChanges));
            }
        }
    );

    it(
        'Should go through the correct sequence of authentication state changes when authenticating as a user while already authenticated as another user',
        async () =>
        {
            global.localStorage.setItem('topgunsocket.authToken', validSignedAuthTokenBob);
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
            global.localStorage.setItem('topgunsocket.authToken', validSignedAuthTokenBob);
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
                expect(error.name).toEqual('AuthTokenError');
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