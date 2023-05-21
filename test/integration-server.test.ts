import * as localStorage from 'localStorage';
import { create, SubscribeOptions } from '../src/client';
import { listen } from '../src/server';
import { SimpleBroker } from '../src/simple-broker';
import { EventObject } from '../src/types';
import { wait } from '../src/utils/wait';

// Add to the global scope like in browser.
global.localStorage = localStorage;

let portNumber = 8008;

let clientOptions;
let serverOptions;

let allowedUsers = {
    bob: true,
    alice: true
};

const TEN_DAYS_IN_SECONDS = 60 * 60 * 24 * 10;
const WS_ENGINE = 'ws';

let validSignedAuthTokenBob = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VybmFtZSI6ImJvYiIsImV4cCI6MzE2Mzc1ODk3OTA4MDMxMCwiaWF0IjoxNTAyNzQ3NzQ2fQ.dSZOfsImq4AvCu-Or3Fcmo7JNv1hrV3WqxaiSKkTtAo';
let validSignedAuthTokenAlice = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VybmFtZSI6ImFsaWNlIiwiaWF0IjoxNTE4NzI4MjU5LCJleHAiOjMxNjM3NTg5NzkwODAzMTB9.XxbzPPnnXrJfZrS0FJwb_EAhIu2VY5i7rGyUThtNLh4';
let invalidSignedAuthToken = 'fakebGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.fakec2VybmFtZSI6ImJvYiIsImlhdCI6MTUwMjYyNTIxMywiZXhwIjoxNTAyNzExNjEzfQ.fakemYcOOjM9bzmS4UYRvlWSk_lm3WGHvclmFjLbyOk';

let server, client;

async function resolveAfterTimeout(duration, value) {
    await wait(duration);
    return value;
}

function connectionHandler(socket) {
    (async () => {
        for await (let rpc of socket.procedure('login')) {
            if (allowedUsers[rpc.data.username]) {
                socket.setAuthToken(rpc.data);
                rpc.end();
            } else {
                let err = new Error('Failed to login');
                err.name = 'FailedLoginError';
                rpc.error(err);
            }
        }
    })();

    (async () => {
        for await (let rpc of socket.procedure('loginWithTenDayExpiry')) {
            if (allowedUsers[rpc.data.username]) {
                socket.setAuthToken(rpc.data, {
                    expiresIn: TEN_DAYS_IN_SECONDS
                });
                rpc.end();
            } else {
                let err = new Error('Failed to login');
                err.name = 'FailedLoginError';
                rpc.error(err);
            }
        }
    })();

    (async () => {
        for await (let rpc of socket.procedure('loginWithTenDayExp')) {
            if (allowedUsers[rpc.data.username]) {
                rpc.data.exp = Math.round(Date.now() / 1000) + TEN_DAYS_IN_SECONDS;
                socket.setAuthToken(rpc.data);
                rpc.end();
            } else {
                let err = new Error('Failed to login');
                err.name = 'FailedLoginError';
                rpc.error(err);
            }
        }
    })();

    (async () => {
        for await (let rpc of socket.procedure('loginWithTenDayExpAndExpiry')) {
            if (allowedUsers[rpc.data.username]) {
                rpc.data.exp = Math.round(Date.now() / 1000) + TEN_DAYS_IN_SECONDS;
                socket.setAuthToken(rpc.data, {
                    expiresIn: TEN_DAYS_IN_SECONDS * 100 // 1000 days
                });
                rpc.end();
            } else {
                let err = new Error('Failed to login');
                err.name = 'FailedLoginError';
                rpc.error(err);
            }
        }
    })();

    (async () => {
        for await (let rpc of socket.procedure('loginWithIssAndIssuer')) {
            if (allowedUsers[rpc.data.username]) {
                rpc.data.iss = 'foo';
                try {
                    await socket.setAuthToken(rpc.data, {
                        issuer: 'bar'
                    });
                } catch (err) {}
                rpc.end();
            } else {
                let err = new Error('Failed to login');
                err.name = 'FailedLoginError';
                rpc.error(err);
            }
        }
    })();

    (async () => {
        for await (let rpc of socket.procedure('setAuthKey')) {
            server.signatureKey = rpc.data;
            server.verificationKey = rpc.data;
            rpc.end();
        }
    })();
}

function destroyTestCase() {
    if (client) {
        if (client.state !== client.CLOSED) {
            client.closeAllListeners();
            client.disconnect();
        }
    }
}

describe('Integration tests', () => {
    // Run the server before start
    beforeEach(async () => {
        clientOptions = {
            hostname: '127.0.0.1',
            port: portNumber
        };
        serverOptions = {
            authKey: 'testkey',
            wsEngine: WS_ENGINE
        };

        server = listen(portNumber, serverOptions);

        (async () => {
            for await (let {socket} of server.listener('connection')) {
                connectionHandler(socket);
            }
        })();

        server.addMiddleware(server.MIDDLEWARE_AUTHENTICATE, async function (req) {
            if (req.authToken.username === 'alice') {
                let err = new Error('Blocked by MIDDLEWARE_AUTHENTICATE');
                err.name = 'AuthenticateMiddlewareError';
                throw err;
            }
        });

        await server.listener('ready').once();
    });

    // Close server after each test
    afterEach(async () => {
        portNumber++;
        destroyTestCase();
        server.close();
        global.localStorage.removeItem('asyngular.authToken');
    });

    describe('Socket authentication', () => {
        it('Should not send back error if JWT is not provided in handshake', async () => {
            client = create(clientOptions);
            let event = await client.listener('connect').once();
            expect(event.authError === undefined).toEqual(true);
        });

        it('Should be authenticated on connect if previous JWT token is present', async () => {
            client = create(clientOptions);
            await client.listener('connect').once();
            client.invoke('login', {username: 'bob'});
            await client.listener('authenticate').once();
            expect(client.authState).toEqual('authenticated');
            client.disconnect();
            client.connect();
            let event = await client.listener('connect').once();
            expect(event.isAuthenticated).toEqual(true);
            expect(event.authError === undefined).toEqual(true);
        });

        it('Should send back error if JWT is invalid during handshake', async () => {
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
            expect(event.authError.name).toEqual('AuthTokenInvalidError');
        });

        it('Should allow switching between users', async () => {
            global.localStorage.setItem('asyngular.authToken', validSignedAuthTokenBob);

            let authenticateEvents = [];
            let deauthenticateEvents = [];
            let authenticationStateChangeEvents = [];
            let authStateChangeEvents = [];

            (async () => {
                for await (let stateChangePacket of server.listener('authenticationStateChange')) {
                    authenticationStateChangeEvents.push(stateChangePacket);
                }
            })();

            (async () => {
                for await (let {socket} of server.listener('connection')) {
                    (async () => {
                        for await (let {authToken} of socket.listener('authenticate')) {
                            authenticateEvents.push(authToken);
                        }
                    })();
                    (async () => {
                        for await (let {oldAuthToken} of socket.listener('deauthenticate')) {
                            deauthenticateEvents.push(oldAuthToken);
                        }
                    })();
                    (async () => {
                        for await (let stateChangeData of socket.listener('authStateChange')) {
                            authStateChangeEvents.push(stateChangeData);
                        }
                    })();
                }
            })();

            let clientSocketId;
            client = create(clientOptions);
            await client.listener('connect').once();
            clientSocketId = client.id;
            client.invoke('login', {username: 'alice'});

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

        it('Should emit correct events/data when socket is deauthenticated', async () => {
            global.localStorage.setItem('asyngular.authToken', validSignedAuthTokenBob);

            let authenticationStateChangeEvents = [];
            let authStateChangeEvents = [];

            (async () => {
                for await (let stateChangePacket of server.listener('authenticationStateChange')) {
                    authenticationStateChangeEvents.push(stateChangePacket);
                }
            })();

            client = create(clientOptions);

            (async () => {
                for await (let event of client.listener('connect')) {
                    client.deauthenticate();
                }
            })();

            let {socket} = await server.listener('connection').once();
            let initialAuthToken = socket.authToken;

            (async () => {
                for await (let stateChangeData of socket.listener('authStateChange')) {
                    authStateChangeEvents.push(stateChangeData);
                }
            })();

            let {oldAuthToken} = await socket.listener('deauthenticate').once();
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
        });

        it('Should not authenticate the client if MIDDLEWARE_AUTHENTICATE blocks the authentication', async () => {
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

        it('Token should be available after Promise resolves if token engine signing is synchronous', async () => {
            portNumber++;
            server = listen(portNumber, {
                authKey: serverOptions.authKey,
                wsEngine: WS_ENGINE,
                authSignAsync: false
            });

            (async () => {
                for await (let {socket} of server.listener('connection')) {
                    connectionHandler(socket);
                }
            })();

            await server.listener('ready').once();

            client = create({
                hostname: clientOptions.hostname,
                port: portNumber
            });

            await client.listener('connect').once();

            client.invoke('login', {username: 'bob'});
            await client.listener('authenticate').once();

            expect(client.authState).toEqual('authenticated');
            expect(client.authToken).not.toEqual(null);
            expect(client.authToken.username).toEqual('bob');
        });

        it('If token engine signing is asynchronous, authentication can be captured using the authenticate event', async () => {
            portNumber++;
            server = listen(portNumber, {
                authKey: serverOptions.authKey,
                wsEngine: WS_ENGINE,
                authSignAsync: true
            });

            (async () => {
                for await (let {socket} of server.listener('connection')) {
                    connectionHandler(socket);
                }
            })();

            await server.listener('ready').once();

            client = create({
                hostname: clientOptions.hostname,
                port: portNumber
            });

            await client.listener('connect').once();

            client.invoke('login', {username: 'bob'});
            await client.listener('authenticate').once();

            expect(client.authState).toEqual('authenticated');
            expect(client.authToken).not.toEqual(null);
            expect(client.authToken.username).toEqual('bob');
        });

        it('Should still work if token verification is asynchronous', async () => {
            portNumber++;
            server = listen(portNumber, {
                authKey: serverOptions.authKey,
                wsEngine: WS_ENGINE,
                authVerifyAsync: false
            });

            (async () => {
                for await (let {socket} of server.listener('connection')) {
                    connectionHandler(socket);
                }
            })();

            await server.listener('ready').once();

            client = create({
                hostname: clientOptions.hostname,
                port: portNumber
            });

            await client.listener('connect').once();

            client.invoke('login', {username: 'bob'});

            await client.listener('authenticate').once();

            client.disconnect();
            client.connect();

            let event = await client.listener('connect').once();

            expect(event.isAuthenticated).toEqual(true);
            expect(client.authToken).not.toEqual(null);
            expect(client.authToken.username).toEqual('bob');
        });

        it('Should set the correct expiry when using expiresIn option when creating a JWT with socket.setAuthToken', async () => {
            portNumber++;
            server = listen(portNumber, {
                authKey: serverOptions.authKey,
                wsEngine: WS_ENGINE,
                authVerifyAsync: false
            });

            (async () => {
                for await (let {socket} of server.listener('connection')) {
                    connectionHandler(socket);
                }
            })();

            await server.listener('ready').once();

            client = create({
                hostname: clientOptions.hostname,
                port: portNumber
            });

            await client.listener('connect').once();
            client.invoke('loginWithTenDayExpiry', {username: 'bob'});
            await client.listener('authenticate').once();

            expect(client.authToken).not.toEqual(null);
            expect(client.authToken.exp).not.toEqual(null);
            let dateMillisecondsInTenDays = Date.now() + TEN_DAYS_IN_SECONDS * 1000;
            let dateDifference = Math.abs(dateMillisecondsInTenDays - client.authToken.exp * 1000);
            // Expiry must be accurate within 1000 milliseconds.
            expect(dateDifference < 1000).toEqual(true);
        });

        it('Should set the correct expiry when adding exp claim when creating a JWT with socket.setAuthToken', async () => {
            portNumber++;
            server = listen(portNumber, {
                authKey: serverOptions.authKey,
                wsEngine: WS_ENGINE,
                authVerifyAsync: false
            });

            (async () => {
                for await (let {socket} of server.listener('connection')) {
                    connectionHandler(socket);
                }
            })();

            await server.listener('ready').once();

            client = create({
                hostname: clientOptions.hostname,
                port: portNumber
            });

            await client.listener('connect').once();
            client.invoke('loginWithTenDayExp', {username: 'bob'});
            await client.listener('authenticate').once();

            expect(client.authToken).not.toEqual(null);
            expect(client.authToken.exp).not.toEqual(null);
            let dateMillisecondsInTenDays = Date.now() + TEN_DAYS_IN_SECONDS * 1000;
            let dateDifference = Math.abs(dateMillisecondsInTenDays - client.authToken.exp * 1000);
            // Expiry must be accurate within 1000 milliseconds.
            expect(dateDifference < 1000).toEqual(true);
        });

        it('The exp claim should have priority over expiresIn option when using socket.setAuthToken', async () => {
            portNumber++;
            server = listen(portNumber, {
                authKey: serverOptions.authKey,
                wsEngine: WS_ENGINE,
                authVerifyAsync: false
            });

            (async () => {
                for await (let {socket} of server.listener('connection')) {
                    connectionHandler(socket);
                }
            })();

            await server.listener('ready').once();

            client = create({
                hostname: clientOptions.hostname,
                port: portNumber
            });

            await client.listener('connect').once();
            client.invoke('loginWithTenDayExpAndExpiry', {username: 'bob'});
            await client.listener('authenticate').once();

            expect(client.authToken).not.toEqual(null);
            expect(client.authToken.exp).not.toEqual(null);
            let dateMillisecondsInTenDays = Date.now() + TEN_DAYS_IN_SECONDS * 1000;
            let dateDifference = Math.abs(dateMillisecondsInTenDays - client.authToken.exp * 1000);
            // Expiry must be accurate within 1000 milliseconds.
            expect(dateDifference < 1000).toEqual(true);
        });

        it('Should send back error if socket.setAuthToken tries to set both iss claim and issuer option', async () => {
            portNumber++;
            server = listen(portNumber, {
                authKey: serverOptions.authKey,
                wsEngine: WS_ENGINE,
                authVerifyAsync: false
            });
            let warningMap = {};

            (async () => {
                for await (let {socket} of server.listener('connection')) {
                    connectionHandler(socket);
                }
            })();

            await server.listener('ready').once();

            client = create({
                hostname: clientOptions.hostname,
                port: portNumber
            });

            await client.listener('connect').once();

            (async () => {
                await client.listener('authenticate').once();
                throw new Error('Should not pass authentication because the signature should fail');
            })();

            (async () => {
                for await (let {warning} of server.listener('warning')) {
                    expect(warning).not.toEqual(null);
                    warningMap[warning.name] = warning;
                }
            })();

            (async () => {
                for await (let {error} of server.listener('error')) {
                    expect(error).not.toEqual(null);
                    expect(error.name).toEqual('SocketProtocolError');
                }
            })();

            let closePackets = [];

            (async () => {
                let event = await client.listener('close').once();
                closePackets.push(event);
            })();

            let error;
            try {
                await client.invoke('loginWithIssAndIssuer', {username: 'bob'});
            } catch (err) {
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

        it('Should trigger an authTokenSigned event and socket.signedAuthToken should be set after calling the socket.setAuthToken method', async () => {
            portNumber++;
            server = listen(portNumber, {
                authKey: serverOptions.authKey,
                wsEngine: WS_ENGINE,
                authSignAsync: true
            });

            let authTokenSignedEventEmitted = false;

            (async () => {
                for await (let {socket} of server.listener('connection')) {
                    (async () => {
                        for await (let {signedAuthToken} of socket.listener('authTokenSigned')) {
                            authTokenSignedEventEmitted = true;
                            expect(signedAuthToken).not.toEqual(null);
                            expect(signedAuthToken).toEqual(socket.signedAuthToken);
                        }
                    })();

                    (async () => {
                        for await (let req of socket.procedure('login')) {
                            if (allowedUsers[req.data.username]) {
                                socket.setAuthToken(req.data, {async: true});
                                req.end();
                            } else {
                                let err = new Error('Failed to login');
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
                port: portNumber
            });

            await client.listener('connect').once();
            await client.invoke('login', {username: 'bob'});
            await client.listener('authenticate').once();

            expect(authTokenSignedEventEmitted).toEqual(true);
        });

        it('Should reject Promise returned by socket.setAuthToken if token delivery fails and rejectOnFailedDelivery option is true', async () => {
            portNumber++;
            server = listen(portNumber, {
                authKey: serverOptions.authKey,
                wsEngine: WS_ENGINE,
                authSignAsync: true,
                ackTimeout: 1000
            });

            let socketErrors = [];

            (async () => {
                await server.listener('ready').once();
                client = create({
                    hostname: clientOptions.hostname,
                    port: portNumber
                });
                await client.listener('connect').once();
                client.invoke('login', {username: 'bob'});
            })();

            let {socket} = await server.listener('connection').once();

            (async () => {
                for await (let {error} of socket.listener('error')) {
                    socketErrors.push(error);
                }
            })();

            let req = await socket.procedure('login').once();
            if (allowedUsers[req.data.username]) {
                req.end();
                socket.disconnect();
                let error;
                try {
                    await socket.setAuthToken(req.data, {rejectOnFailedDelivery: true});
                } catch (err) {
                    error = err;
                }
                expect(error).not.toEqual(null);
                expect(error.name).toEqual('AuthError');
                await wait(0);
                expect(socketErrors[0]).not.toEqual(null);
                expect(socketErrors[0].name).toEqual('AuthError');
            } else {
                let err = new Error('Failed to login');
                err.name = 'FailedLoginError';
                req.error(err);
            }
        });

        it('Should not reject Promise returned by socket.setAuthToken if token delivery fails and rejectOnFailedDelivery option is not true', async () => {
            portNumber++;
            server = listen(portNumber, {
                authKey: serverOptions.authKey,
                wsEngine: WS_ENGINE,
                authSignAsync: true,
                ackTimeout: 1000
            });

            let socketErrors = [];

            (async () => {
                await server.listener('ready').once();
                client = create({
                    hostname: clientOptions.hostname,
                    port: portNumber
                });
                await client.listener('connect').once();
                client.invoke('login', {username: 'bob'});
            })();

            let {socket} = await server.listener('connection').once();

            (async () => {
                for await (let {error} of socket.listener('error')) {
                    socketErrors.push(error);
                }
            })();

            let req = await socket.procedure('login').once();
            if (allowedUsers[req.data.username]) {
                req.end();
                socket.disconnect();
                let error;
                try {
                    await socket.setAuthToken(req.data);
                } catch (err) {
                    error = err;
                }
                expect(error).toEqual(null);
                await wait(0);
                expect(socketErrors[0]).not.toEqual(null);
                expect(socketErrors[0].name).toEqual('AuthError');
            } else {
                let err = new Error('Failed to login');
                err.name = 'FailedLoginError';
                req.error(err);
            }
        });

        it('The verifyToken method of the authEngine receives correct params', async () => {
            global.localStorage.setItem('asyngular.authToken', validSignedAuthTokenBob);

            portNumber++;
            server = listen(portNumber, {
                authKey: serverOptions.authKey,
                wsEngine: WS_ENGINE
            });

            (async () => {
                for await (let {socket} of server.listener('connection')) {
                    connectionHandler(socket);
                }
            })();

            (async () => {
                await server.listener('ready').once();
                client = create({
                    hostname: clientOptions.hostname,
                    port: portNumber
                });
            })();

            return new Promise<void>((resolve) => {
                server.setAuthEngine({
                    verifyToken: async (signedAuthToken, verificationKey, verificationOptions) => {
                        await wait(500);
                        expect(signedAuthToken).toEqual(validSignedAuthTokenBob);
                        expect(verificationKey).toEqual(serverOptions.authKey);
                        expect(verificationOptions).not.toEqual(null);
                        expect(verificationOptions.socket).not.toEqual(null);
                        resolve();
                        return Promise.resolve({});
                    }
                });
            });
        });

        it('Should remove client data from the server when client disconnects before authentication process finished', async () => {
            portNumber++;
            server = listen(portNumber, {
                authKey: serverOptions.authKey,
                wsEngine: WS_ENGINE
            });
            server.setAuthEngine({
                verifyToken: function (signedAuthToken, verificationKey, verificationOptions) {
                    return resolveAfterTimeout(500, {});
                }
            });

            (async () => {
                for await (let {socket} of server.listener('connection')) {
                    connectionHandler(socket);
                }
            })();

            await server.listener('ready').once();
            client = create({
                hostname: clientOptions.hostname,
                port: portNumber
            });

            let serverSocket;
            (async () => {
                for await (let {socket} of server.listener('handshake')) {
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

    describe('Socket handshake', () => {
        it('Exchange is attached to socket before the handshake event is triggered', async () => {
            portNumber++;
            server = listen(portNumber, {
                authKey: serverOptions.authKey,
                wsEngine: WS_ENGINE
            });

            (async () => {
                for await (let {socket} of server.listener('connection')) {
                    connectionHandler(socket);
                }
            })();

            await server.listener('ready').once();

            client = create({
                hostname: clientOptions.hostname,
                port: portNumber
            });

            let {socket} = await server.listener('handshake').once();
            expect(socket.exchange).not.toEqual(null);
        });
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
                    connectionHandler(event.socket);
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
            expect(connectionEvent.authError).toEqual(null);
            expect(connectionEvent.isAuthenticated).toEqual(false);

            expect(connectStatus).not.toEqual(null);
            expect(connectStatus.id).toEqual(socketId);
            expect(connectStatus.pingTimeout).toEqual(server.pingTimeout);
            expect(connectStatus.authError).toEqual(null);
            expect(connectStatus.isAuthenticated).toEqual(false);

            expect(clientConnectStatus).not.toEqual(null);
            expect(clientConnectStatus.id).toEqual(socketId);
            expect(clientConnectStatus.pingTimeout).toEqual(server.pingTimeout);
            expect(clientConnectStatus.authError).toEqual(null);
            expect(clientConnectStatus.isAuthenticated).toEqual(false);
            expect(clientConnectStatus['foo']).toEqual(null);
            // Client socket status should be a clone of server socket status; not
            // a reference to the same object.
            expect(clientConnectStatus['foo']).not.toEqual(connectStatus.foo);
        });
    });

    describe('Socket disconnection', () => {
        it('Server-side socket disconnect event should not trigger if the socket did not complete the handshake; instead, it should trigger connectAbort', async () => {
            portNumber++;
            server = listen(portNumber, {
                authKey: serverOptions.authKey,
                wsEngine: WS_ENGINE
            });
            server.setAuthEngine({
                verifyToken: function (signedAuthToken, verificationKey, verificationOptions) {
                    return resolveAfterTimeout(500, {});
                }
            });

            let connectionOnServer = false;

            (async () => {
                for await (let {socket} of server.listener('connection')) {
                    connectionOnServer = true;
                    connectionHandler(socket);
                }
            })();

            await server.listener('ready').once();

            client = create({
                hostname: clientOptions.hostname,
                port: portNumber
            });

            let socketDisconnected = false;
            let socketDisconnectedBeforeConnect = false;
            let clientSocketAborted = false;

            (async () => {
                let {socket} = await server.listener('handshake').once();
                expect(server.pendingClientsCount).toEqual(1);
                expect(server.pendingClients[socket.id]).not.toEqual(null);

                (async () => {
                    await socket.listener('disconnect').once();
                    if (!connectionOnServer) {
                        socketDisconnectedBeforeConnect = true;
                    }
                    socketDisconnected = true;
                })();

                (async () => {
                    let event = await socket.listener('connectAbort').once();
                    clientSocketAborted = true;
                    expect(event.code).toEqual(4444);
                    expect(event.reason).toEqual('Disconnect before handshake');
                })();
            })();

            let serverDisconnected = false;
            let serverSocketAborted = false;

            (async () => {
                await server.listener('disconnection').once();
                serverDisconnected = true;
            })();

            (async () => {
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

        it('Server-side socket disconnect event should trigger if the socket completed the handshake (not connectAbort)', async () => {
            portNumber++;
            server = listen(portNumber, {
                authKey: serverOptions.authKey,
                wsEngine: WS_ENGINE
            });
            server.setAuthEngine({
                verifyToken: function (signedAuthToken, verificationKey, verificationOptions) {
                    return resolveAfterTimeout(10, {});
                }
            });

            let connectionOnServer = false;

            (async () => {
                for await (let {socket} of server.listener('connection')) {
                    connectionOnServer = true;
                    connectionHandler(socket);
                }
            })();

            await server.listener('ready').once();

            client = create({
                hostname: clientOptions.hostname,
                port: portNumber
            });

            let socketDisconnected = false;
            let socketDisconnectedBeforeConnect = false;
            let clientSocketAborted = false;

            (async () => {
                let {socket} = await server.listener('handshake').once();
                expect(server.pendingClientsCount).toEqual(1);
                expect(server.pendingClients[socket.id]).not.toEqual(null);

                (async () => {
                    let event = await socket.listener('disconnect').once();
                    if (!connectionOnServer) {
                        socketDisconnectedBeforeConnect = true;
                    }
                    socketDisconnected = true;
                    expect(event.code).toEqual(4445);
                    expect(event.reason).toEqual('Disconnect after handshake');
                })();

                (async () => {
                    let event = await socket.listener('connectAbort').once();
                    clientSocketAborted = true;
                })();
            })();

            let serverDisconnected = false;
            let serverSocketAborted = false;

            (async () => {
                await server.listener('disconnection').once();
                serverDisconnected = true;
            })();

            (async () => {
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

        it('The close event should trigger when the socket loses the connection before the handshake', async () => {
            let connectionOnServer = false;
            portNumber++;
            server = listen(portNumber, {
                authKey: serverOptions.authKey,
                wsEngine: WS_ENGINE
            });
            server.setAuthEngine({
                verifyToken: function (signedAuthToken, verificationKey, verificationOptions) {
                    return resolveAfterTimeout(500, {});
                }
            });

            (async () => {
                for await (let {socket} of server.listener('connection')) {
                    connectionOnServer = true;
                    connectionHandler(socket);
                }
            })();

            await server.listener('ready').once();

            client = create({
                hostname: clientOptions.hostname,
                port: portNumber
            });

            let serverSocketClosed = false;
            let serverSocketAborted = false;
            let serverClosure = false;

            (async () => {
                for await (let {socket} of server.listener('handshake')) {
                    let event = await socket.listener('close').once();
                    serverSocketClosed = true;
                    expect(event.code).toEqual(4444);
                    expect(event.reason).toEqual('Disconnect before handshake');
                }
            })();

            (async () => {
                for await (let event of server.listener('connectionAbort')) {
                    serverSocketAborted = true;
                }
            })();

            (async () => {
                for await (let event of server.listener('closure')) {
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

        it('The close event should trigger when the socket loses the connection after the handshake', async () => {
            let connectionOnServer = false;
            portNumber++;
            server = listen(portNumber, {
                authKey: serverOptions.authKey,
                wsEngine: WS_ENGINE
            });
            server.setAuthEngine({
                verifyToken: function (signedAuthToken, verificationKey, verificationOptions) {
                    return resolveAfterTimeout(0, {});
                }
            });

            (async () => {
                for await (let {socket} of server.listener('connection')) {
                    connectionOnServer = true;
                    connectionHandler(socket);
                }
            })();

            await server.listener('ready').once();

            client = create({
                hostname: clientOptions.hostname,
                port: portNumber
            });

            let serverSocketClosed = false;
            let serverSocketDisconnected = false;
            let serverClosure = false;

            (async () => {
                for await (let {socket} of server.listener('handshake')) {
                    let event = await socket.listener('close').once();
                    serverSocketClosed = true;
                    expect(event.code).toEqual(4445);
                    expect(event.reason).toEqual('Disconnect after handshake');
                }
            })();

            (async () => {
                for await (let event of server.listener('disconnection')) {
                    serverSocketDisconnected = true;
                }
            })();

            (async () => {
                for await (let event of server.listener('closure')) {
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

    describe('Socket pub/sub', () => {
        it('Should support subscription batching', async () => {
            portNumber++;
            server = listen(portNumber, {
                authKey: serverOptions.authKey,
                wsEngine: WS_ENGINE
            });

            (async () => {
                for await (let {socket} of server.listener('connection')) {
                    connectionHandler(socket);
                    let isFirstMessage = true;

                    (async () => {
                        for await (let {message} of socket.listener('message')) {
                            if (isFirstMessage) {
                                let data = JSON.parse(message);
                                // All 20 subscriptions should arrive as a single message.
                                expect(data.length).toEqual(20);
                                isFirstMessage = false;
                            }
                        }
                    })();
                }
            })();

            let subscribeMiddlewareCounter = 0;

            // Each subscription should pass through the middleware individually, even
            // though they were sent as a batch/array.
            server.addMiddleware(server.MIDDLEWARE_SUBSCRIBE, (req, next) =>
            {
                subscribeMiddlewareCounter++;
                expect(req.channel.indexOf('my-channel-')).toEqual(0);
                if (req.channel === 'my-channel-10') {
                    expect(JSON.stringify(req.data)).toEqual(JSON.stringify({foo: 123}));
                } else if (req.channel === 'my-channel-12') {
                    // Block my-channel-12
                    let err = new Error('You cannot subscribe to channel 12');
                    err.name = 'UnauthorizedSubscribeError';
                    next(err);
                    return;
                }
                next();
            });

            await server.listener('ready').once();

            client = create({
                hostname: clientOptions.hostname,
                port: portNumber
            });

            let channelList = [];
            for (let i = 0; i < 20; i++) {
                let subscribeOptions: SubscribeOptions = {
                    batch: true
                };
                if (i === 10) {
                    subscribeOptions.data = {foo: 123};
                }
                channelList.push(
                    client.subscribe('my-channel-' + i, subscribeOptions)
                );
            }

            (async () => {
                for await (let event of channelList[12].listener('subscribe')) {
                    throw new Error('The my-channel-12 channel should have been blocked by MIDDLEWARE_SUBSCRIBE');
                }
            })();

            (async () => {
                for await (let event of channelList[12].listener('subscribeFail')) {
                    expect(event.error).not.toEqual(null);
                    expect(event.error.name).toEqual('UnauthorizedSubscribeError');
                }
            })();

            (async () => {
                for await (let event of channelList[0].listener('subscribe')) {
                    client.publish('my-channel-19', 'Hello!');
                }
            })();

            for await (let data of channelList[19]) {
                expect(data).toEqual('Hello!');
                expect(subscribeMiddlewareCounter).toEqual(20);
                break;
            }
        });

        it('Client should not be able to subscribe to a channel before the handshake has completed', async () => {
            portNumber++;
            server = listen(portNumber, {
                authKey: serverOptions.authKey,
                wsEngine: WS_ENGINE
            });

            server.setAuthEngine({
                verifyToken: function (signedAuthToken, verificationKey, verificationOptions) {
                    return resolveAfterTimeout(500, {});
                }
            });

            (async () => {
                for await (let {socket} of server.listener('connection')) {
                    connectionHandler(socket);
                }
            })();

            await server.listener('ready').once();

            client = create({
                hostname: clientOptions.hostname,
                port: portNumber
            });

            let isSubscribed = false;
            let error;

            (async () => {
                for await (let event of server.listener('subscription')) {
                    isSubscribed = true;
                }
            })();

            // Hack to capture the error without relying on the standard client flow.
            client.transport._callbackMap[2] = {
                event: '#subscribe',
                data: {"channel":"someChannel"},
                callback: function (err) {
                    error = err;
                }
            };

            // Trick the server by sending a fake subscribe before the handshake is done.
            client.transport.socket.on('open', () => {
                client.send('{"event":"#subscribe","data":{"channel":"someChannel"},"cid":2}');
            });

            await wait(1000);
            expect(isSubscribed).toEqual(false);
            expect(error).not.toEqual(null);
            expect(error.name).toEqual('InvalidActionError');
        });

        it('Server should be able to handle invalid #subscribe and #unsubscribe and #publish events without crashing', async () => {
            portNumber++;
            server = listen(portNumber, {
                authKey: serverOptions.authKey,
                wsEngine: WS_ENGINE
            });

            (async () => {
                for await (let {socket} of server.listener('connection')) {
                    connectionHandler(socket);
                }
            })();

            await server.listener('ready').once();

            client = create({
                hostname: clientOptions.hostname,
                port: portNumber
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
                event: '#subscribe',
                data: [null],
                callback: function (err) {
                    nullInChannelArrayError = err;
                }
            };
            client.transport._callbackMap[3] = {
                event: '#subscribe',
                data: {"channel": {"hello": 123}},
                callback: function (err) {
                    objectAsChannelNameError = err;
                }
            };
            client.transport._callbackMap[4] = {
                event: '#subscribe',
                data: null,
                callback: function (err) {
                    nullChannelNameError = err;
                }
            };
            client.transport._callbackMap[5] = {
                event: '#unsubscribe',
                data: [null],
                callback: function (err) {
                    nullUnsubscribeError = err;
                }
            };
            client.transport._callbackMap[6] = {
                event: '#publish',
                data: null,
                callback: function (err) {
                    undefinedPublishError = err;
                }
            };
            client.transport._callbackMap[7] = {
                event: '#publish',
                data: {"channel": {"hello": 123}},
                callback: function (err) {
                    objectAsChannelNamePublishError = err;
                }
            };
            client.transport._callbackMap[8] = {
                event: '#publish',
                data: {"channel": null},
                callback: function (err) {
                    nullPublishError = err;
                }
            };

            (async () => {
                for await (let event of client.listener('connect')) {
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
        });

        it('When default SimpleBroker broker engine is used, disconnect event should trigger before unsubscribe event', async () => {
            portNumber++;
            server = listen(portNumber, {
                authKey: serverOptions.authKey,
                wsEngine: WS_ENGINE
            });

            let eventList = [];

            (async () => {
                await server.listener('ready').once();

                client = create({
                    hostname: clientOptions.hostname,
                    port: portNumber
                });

                await client.subscribe('foo').listener('subscribe').once();
                await wait(200);
                client.disconnect();
            })();

            let {socket} = await server.listener('connection').once();

            (async () => {
                for await (let event of socket.listener('unsubscribe')) {
                    eventList.push({
                        type: 'unsubscribe',
                        channel: event.channel
                    });
                }
            })();

            let disconnectPacket = await socket.listener('disconnect').once();
            eventList.push({
                type: 'disconnect',
                code: disconnectPacket.code,
                reason: disconnectPacket.data
            });

            await wait(0);
            expect(eventList[0].type).toEqual('disconnect');
            expect(eventList[1].type).toEqual('unsubscribe');
            expect(eventList[1].channel).toEqual('foo');
        });

        it('When default SimpleBroker broker engine is used, scServer.exchange should support consuming data from a channel', async () => {
            portNumber++;
            server = listen(portNumber, {
                authKey: serverOptions.authKey,
                wsEngine: WS_ENGINE
            });

            await server.listener('ready').once();

            client = create({
                hostname: clientOptions.hostname,
                port: portNumber
            });

            (async () => {
                await client.listener('connect').once();

                client.publish('foo', 'hi1');
                await wait(10);
                client.publish('foo', 'hi2');
            })();

            let receivedSubscribedData = [];
            let receivedChannelData = [];

            (async () => {
                let subscription = server.exchange.subscribe('foo');
                for await (let data of subscription) {
                    receivedSubscribedData.push(data);
                }
            })();

            let channel = server.exchange.channel('foo');
            for await (let data of channel) {
                receivedChannelData.push(data);
                if (receivedChannelData.length > 1) {
                    break;
                }
            }

            expect(server.exchange.isSubscribed('foo')).toEqual(true);
            expect(server.exchange.subscriptions().join(',')).toEqual('foo');

            expect(receivedSubscribedData[0]).toEqual('hi1');
            expect(receivedSubscribedData[1]).toEqual('hi2');
            expect(receivedChannelData[0]).toEqual('hi1');
            expect(receivedChannelData[1]).toEqual('hi2');
        });

        it('When default SimpleBroker broker engine is used, scServer.exchange should support publishing data to a channel', async () => {
            portNumber++;
            server = listen(portNumber, {
                authKey: serverOptions.authKey,
                wsEngine: WS_ENGINE
            });

            await server.listener('ready').once();

            client = create({
                hostname: clientOptions.hostname,
                port: portNumber
            });

            (async () => {
                await client.listener('subscribe').once();
                server.exchange.publish('bar', 'hello1');
                await wait(10);
                server.exchange.publish('bar', 'hello2');
            })();

            let receivedSubscribedData = [];
            let receivedChannelData = [];

            (async () => {
                let subscription = client.subscribe('bar');
                for await (let data of subscription) {
                    receivedSubscribedData.push(data);
                }
            })();

            let channel = client.channel('bar');
            for await (let data of channel) {
                receivedChannelData.push(data);
                if (receivedChannelData.length > 1) {
                    break;
                }
            }

            expect(receivedSubscribedData[0]).toEqual('hello1');
            expect(receivedSubscribedData[1]).toEqual('hello2');
            expect(receivedChannelData[0]).toEqual('hello1');
            expect(receivedChannelData[1]).toEqual('hello2');
        });

        it('When disconnecting a socket, the unsubscribe event should trigger after the disconnect event', async () => {
            portNumber++;
            let customBrokerEngine = new SimpleBroker();
            let defaultUnsubscribeSocket = customBrokerEngine.unsubscribeSocket;
            customBrokerEngine.unsubscribeSocket = function (socket, channel) {
                return resolveAfterTimeout(100, defaultUnsubscribeSocket.call(this, socket, channel));
            };

            server = listen(portNumber, {
                authKey: serverOptions.authKey,
                wsEngine: WS_ENGINE,
                brokerEngine: customBrokerEngine
            });

            let eventList = [];

            (async () => {
                await server.listener('ready').once();
                client = create({
                    hostname: clientOptions.hostname,
                    port: portNumber
                });

                for await (let event of client.subscribe('foo').listener('subscribe')) {
                    (async () => {
                        await wait(200);
                        client.disconnect();
                    })();
                }
            })();

            let {socket} = await server.listener('connection').once();

            (async () => {
                for await (let event of socket.listener('unsubscribe')) {
                    eventList.push({
                        type: 'unsubscribe',
                        channel: event.channel
                    });
                }
            })();

            let event = await socket.listener('disconnect').once();

            eventList.push({
                type: 'disconnect',
                code: event.code,
                reason: event.reason
            });

            await wait(0);
            expect(eventList[0].type).toEqual('disconnect');
            expect(eventList[1].type).toEqual('unsubscribe');
            expect(eventList[1].channel).toEqual('foo');
        });

        it('Socket should emit an error when trying to unsubscribe to a channel which it is not subscribed to', async () => {
            portNumber++;

            server = listen(portNumber, {
                authKey: serverOptions.authKey,
                wsEngine: WS_ENGINE
            });

            let errorList = [];

            (async () => {
                for await (let {socket} of server.listener('connection')) {
                    (async () => {
                        for await (let {error} of socket.listener('error')) {
                            errorList.push(error);
                        }
                    })();
                }
            })();

            await server.listener('ready').once();

            client = create({
                hostname: clientOptions.hostname,
                port: portNumber
            });

            let error;
            try {
                await client.invoke('#unsubscribe', 'bar');
            } catch (err) {
                error = err;
            }
            expect(error).not.toEqual(null);
            expect(error.name).toEqual('BrokerError');

            await wait(100);
            expect(errorList.length).toEqual(1);
            expect(errorList[0].name).toEqual('BrokerError');
        });

        it('Socket should not receive messages from a channel which it has only just unsubscribed from (accounting for delayed unsubscribe by brokerEngine)', async () => {
            portNumber++;
            let customBrokerEngine = new SimpleBroker();
            let defaultUnsubscribeSocket = customBrokerEngine.unsubscribeSocket;
            customBrokerEngine.unsubscribeSocket = function (socket, channel) {
                return resolveAfterTimeout(300, defaultUnsubscribeSocket.call(this, socket, channel));
            };

            server = listen(portNumber, {
                authKey: serverOptions.authKey,
                wsEngine: WS_ENGINE,
                brokerEngine: customBrokerEngine
            });

            (async () => {
                for await (let {socket} of server.listener('connection')) {
                    (async () => {
                        for await (let event of socket.listener('unsubscribe')) {
                            if (event.channel === 'foo') {
                                server.exchange.publish('foo', 'hello');
                            }
                        }
                    })();
                }
            })();

            await server.listener('ready').once();

            client = create({
                hostname: clientOptions.hostname,
                port: portNumber
            });
            // Stub the isSubscribed method so that it always returns true.
            // That way the client will always invoke watchers whenever
            // it receives a #publish event.
            client.isSubscribed = () => { return true; };

            let messageList = [];

            let fooChannel = client.subscribe('foo');

            (async () => {
                for await (let data of fooChannel) {
                    messageList.push(data);
                }
            })();

            (async () => {
                for await (let event of fooChannel.listener('subscribe')) {
                    client.invoke('#unsubscribe', 'foo');
                }
            })();

            await wait(200);
            expect(messageList.length).toEqual(0);
        });

        it('Socket channelSubscriptions and channelSubscriptionsCount should update when socket.kickOut(channel) is called', async () => {
            portNumber++;

            server = listen(portNumber, {
                authKey: serverOptions.authKey,
                wsEngine: WS_ENGINE
            });

            let errorList = [];
            let serverSocket;
            let wasKickOutCalled = false;

            (async () => {
                for await (let {socket} of server.listener('connection')) {
                    serverSocket = socket;

                    (async () => {
                        for await (let {error} of socket.listener('error')) {
                            errorList.push(error);
                        }
                    })();

                    (async () => {
                        for await (let event of socket.listener('subscribe')) {
                            if (event.channel === 'foo') {
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
                port: portNumber
            });

            client.subscribe('foo');

            await wait(100);
            expect(errorList.length).toEqual(0);
            expect(wasKickOutCalled).toEqual(true);
            expect(serverSocket.channelSubscriptionsCount).toEqual(0);
            expect(Object.keys(serverSocket.channelSubscriptions).length).toEqual(0);
        });

        it('Socket channelSubscriptions and channelSubscriptionsCount should update when socket.kickOut() is called without arguments', async () => {
            portNumber++;

            server = listen(portNumber, {
                authKey: serverOptions.authKey,
                wsEngine: WS_ENGINE
            });

            let errorList = [];
            let serverSocket;
            let wasKickOutCalled = false;

            (async () => {
                for await (let {socket} of server.listener('connection')) {
                    serverSocket = socket;

                    (async () => {
                        for await (let {error} of socket.listener('error')) {
                            errorList.push(error);
                        }
                    })();

                    (async () => {
                        for await (let event of socket.listener('subscribe')) {
                            if (socket.channelSubscriptionsCount === 2) {
                                await wait(50);
                                wasKickOutCalled = true;
                                socket.kickOut();
                            }
                        }
                    })();
                }
            })();

            await server.listener('ready').once();

            client = create({
                hostname: clientOptions.hostname,
                port: portNumber
            });

            client.subscribe('foo');
            client.subscribe('bar');

            await wait(200);
            expect(errorList.length).toEqual(0);
            expect(wasKickOutCalled).toEqual(true);
            expect(serverSocket.channelSubscriptionsCount).toEqual(0);
            expect(Object.keys(serverSocket.channelSubscriptions).length).toEqual(0);
        });
    });

    describe('Socket destruction', () => {
        it('Server socket destroy should disconnect the socket', async () => {
            portNumber++;
            server = listen(portNumber, {
                authKey: serverOptions.authKey,
                wsEngine: WS_ENGINE
            });

            (async () => {
                for await (let {socket} of server.listener('connection')) {
                    await wait(100);
                    socket.destroy(1000, 'Custom reason');
                }
            })();

            await server.listener('ready').once();

            client = create({
                hostname: clientOptions.hostname,
                port: portNumber
            });

            let {code, reason} = await client.listener('disconnect').once();
            expect(code).toEqual(1000);
            expect(reason).toEqual('Custom reason');
            expect(server.clientsCount).toEqual(0);
            expect(server.pendingClientsCount).toEqual(0);
        });

        it('Server socket destroy should set the active property on the socket to false', async () => {
            portNumber++;
            server = listen(portNumber, {
                authKey: serverOptions.authKey,
                wsEngine: WS_ENGINE
            });

            let serverSocket;

            (async () => {
                for await (let {socket} of server.listener('connection')) {
                    serverSocket = socket;
                    expect(socket.active).toEqual(true);
                    await wait(100);
                    socket.destroy();
                }
            })();

            await server.listener('ready').once();
            client = create({
                hostname: clientOptions.hostname,
                port: portNumber
            });

            await client.listener('disconnect').once();
            expect(serverSocket.active).toEqual(false);
        });
    });

    describe('Socket Ping/pong', () => {
        describe('When when pingTimeoutDisabled is not set', () => {
            // Launch server with ping options before start
            beforeEach(async () => {
                portNumber++;
                // Intentionally make pingInterval higher than pingTimeout, that
                // way the client will never receive a ping or send back a pong.
                server = listen(portNumber, {
                    authKey: serverOptions.authKey,
                    wsEngine: WS_ENGINE,
                    pingInterval: 2000,
                    pingTimeout: 500
                });

                await server.listener('ready').once();
            });

            // Shut down server afterwards
            afterEach(async () => {
                destroyTestCase();
                server.close();
            });

            it('Should disconnect socket if server does not receive a pong from client before timeout', async () => {
                client = create({
                    hostname: clientOptions.hostname,
                    port: portNumber
                });

                let serverWarning = null;
                (async () => {
                    for await (let {warning} of server.listener('warning')) {
                        serverWarning = warning;
                    }
                })();

                let serverDisconnectionCode = null;
                (async () => {
                    for await (let event of server.listener('disconnection')) {
                        serverDisconnectionCode = event.code;
                    }
                })();

                let clientError = null;
                (async () => {
                    for await (let {error} of client.listener('error')) {
                        clientError = error;
                    }
                })();

                let clientDisconnectCode = null;
                (async () => {
                    for await (let event of client.listener('disconnect')) {
                        clientDisconnectCode = event.code;
                    }
                })();

                await wait(1000);
                expect(clientError).not.toEqual(null);
                expect(clientError.name).toEqual('SocketProtocolError');
                expect(clientDisconnectCode).toEqual(4001);

                expect(serverWarning).not.toEqual(null);
                expect(serverWarning.name).toEqual('SocketProtocolError');
                expect(serverDisconnectionCode).toEqual(4001);
            });
        });

        describe('When when pingTimeoutDisabled is true', () => {
            // Launch server with ping options before start
            beforeEach(async () => {
                portNumber++;
                // Intentionally make pingInterval higher than pingTimeout, that
                // way the client will never receive a ping or send back a pong.
                server = listen(portNumber, {
                    authKey: serverOptions.authKey,
                    wsEngine: WS_ENGINE,
                    pingInterval: 2000,
                    pingTimeout: 500,
                    pingTimeoutDisabled: true
                });

                await server.listener('ready').once();
            });

            // Shut down server afterwards
            afterEach(async () => {
                destroyTestCase();
                server.close();
            });

            it('Should not disconnect socket if server does not receive a pong from client before timeout', async () => {
                client = create({
                    hostname: clientOptions.hostname,
                    port: portNumber,
                    pingTimeoutDisabled: true
                });

                let serverWarning = null;
                (async () => {
                    for await (let {warning} of server.listener('warning')) {
                        serverWarning = warning;
                    }
                })();

                let serverDisconnectionCode = null;
                (async () => {
                    for await (let event of server.listener('disconnection')) {
                        serverDisconnectionCode = event.code;
                    }
                })();

                let clientError = null;
                (async () => {
                    for await (let {error} of client.listener('error')) {
                        clientError = error;
                    }
                })();

                let clientDisconnectCode = null;
                (async () => {
                    for await (let event of client.listener('disconnect')) {
                        clientDisconnectCode = event.code;
                    }
                })();

                await wait(1000);
                expect(clientError).toEqual(null);
                expect(clientDisconnectCode).toEqual(null);

                expect(serverWarning).toEqual(null);
                expect(serverDisconnectionCode).toEqual(null);
            });
        });
    });

    describe('Middleware', () => {
        let middlewareFunction;
        let middlewareWasExecuted = false;

        // Launch server without middleware before start
        beforeEach(async () => {
            portNumber++;
            server = listen(portNumber, {
                authKey: serverOptions.authKey,
                wsEngine: WS_ENGINE
            });
            await server.listener('ready').once();
        });

        // Shut down server afterwards
        afterEach(async () => {
            destroyTestCase();
            server.close();
        });

        describe('MIDDLEWARE_AUTHENTICATE', () => {
            it('Should not run authenticate middleware if JWT token does not exist', async () => {
                middlewareFunction = async function (req) {
                    middlewareWasExecuted = true;
                };
                server.addMiddleware(server.MIDDLEWARE_AUTHENTICATE, middlewareFunction);

                client = create({
                    hostname: clientOptions.hostname,
                    port: portNumber
                });

                await client.listener('connect').once();
                expect(middlewareWasExecuted).not.toEqual(true);
            });

            it('Should run authenticate middleware if JWT token exists', async () => {
                global.localStorage.setItem('asyngular.authToken', validSignedAuthTokenBob);

                middlewareFunction = async function (req) {
                    middlewareWasExecuted = true;
                };
                server.addMiddleware(server.MIDDLEWARE_AUTHENTICATE, middlewareFunction);

                client = create({
                    hostname: clientOptions.hostname,
                    port: portNumber
                });

                (async () => {
                    try {
                        await client.invoke('login', {username: 'bob'});
                    } catch (err) {}
                })();

                await client.listener('authenticate').once();
                expect(middlewareWasExecuted).toEqual(true);
            });
        });

        describe('MIDDLEWARE_HANDSHAKE_AG', () => {
            it('Should trigger correct events if MIDDLEWARE_HANDSHAKE_AG blocks with an error', async () => {
                let middlewareWasExecuted = false;
                let serverWarnings = [];
                let clientErrors = [];
                let abortStatus;

                middlewareFunction = async function (req) {
                    await wait(100);
                    middlewareWasExecuted = true;
                    console.log('middlewareWasExecuted!!!');
                    let err = new Error('SC handshake failed because the server was too lazy');
                    err.name = 'TooLazyHandshakeError';
                    throw err;
                };
                server.addMiddleware(server.MIDDLEWARE_HANDSHAKE_AG, middlewareFunction);

                (async () => {
                    for await (let {warning} of server.listener('warning')) {
                        serverWarnings.push(warning);
                    }
                })();

                client = create({
                    hostname: clientOptions.hostname,
                    port: portNumber
                });

                (async () => {
                    for await (let {error} of client.listener('error')) {
                        clientErrors.push(error);
                    }
                })();

                (async () => {
                    let event = await client.listener('connectAbort').once();
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

            it('Should send back default 4008 status code if MIDDLEWARE_HANDSHAKE_AG blocks without providing a status code', async () => {
                let middlewareWasExecuted = false;
                let abortStatus;
                let abortReason;

                middlewareFunction = async function (req) {
                    await wait(100);
                    middlewareWasExecuted = true;
                    let err = new Error('SC handshake failed because the server was too lazy');
                    err.name = 'TooLazyHandshakeError';
                    throw err;
                };
                server.addMiddleware(server.MIDDLEWARE_HANDSHAKE_AG, middlewareFunction);

                client = create({
                    hostname: clientOptions.hostname,
                    port: portNumber
                });

                (async () => {
                    let event = await client.listener('connectAbort').once();
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

            it('Should send back custom status code if MIDDLEWARE_HANDSHAKE_AG blocks by providing a status code', async () => {
                let middlewareWasExecuted = false;
                let abortStatus;
                let abortReason;

                middlewareFunction = async function (req) {
                    await wait(100);
                    middlewareWasExecuted = true;
                    let err = new Error('SC handshake failed because of invalid query auth parameters');
                    err.name = 'InvalidAuthQueryHandshakeError';
                    // Set custom 4501 status code as a property of the error.
                    // We will treat this code as a fatal authentication failure on the front end.
                    // A status code of 4500 or higher means that the client shouldn't try to reconnect.
                    err['statusCode'] = 4501;
                    throw err;
                };
                server.addMiddleware(server.MIDDLEWARE_HANDSHAKE_AG, middlewareFunction);

                client = create({
                    hostname: clientOptions.hostname,
                    port: portNumber
                });

                (async () => {
                    let event = await client.listener('connectAbort').once();
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

            it('Should connect with a delay if next() is called after a timeout inside the middleware function', async () => {
                let createConnectionTime = null;
                let connectEventTime = null;
                let abortStatus;
                let abortReason;

                middlewareFunction = async req => await wait(500);
                server.addMiddleware(server.MIDDLEWARE_HANDSHAKE_AG, middlewareFunction);

                createConnectionTime = Date.now();
                client = create({
                    hostname: clientOptions.hostname,
                    port: portNumber
                });

                (async () => {
                    let event = await client.listener('connectAbort').once();
                    abortStatus = event.code;
                    abortReason = event.reason;
                })();

                await client.listener('connect').once();
                connectEventTime = Date.now();
                expect(connectEventTime - createConnectionTime > 400).toEqual(true);
            });
        });
    });
});
