import { wait } from '../src/utils/wait';
import { TGClientSocket } from '../src/client';
import { TGSocketServer } from '../src/server';

export const TEN_DAYS_IN_SECONDS = 60 * 60 * 24 * 10;
export const WS_ENGINE           = 'ws';

export let validSignedAuthTokenBob   = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VybmFtZSI6ImJvYiIsImV4cCI6MzE2Mzc1ODk3OTA4MDMxMCwiaWF0IjoxNTAyNzQ3NzQ2fQ.dSZOfsImq4AvCu-Or3Fcmo7JNv1hrV3WqxaiSKkTtAo';
export let validSignedAuthTokenAlice = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VybmFtZSI6ImFsaWNlIiwiaWF0IjoxNTE4NzI4MjU5LCJleHAiOjMxNjM3NTg5NzkwODAzMTB9.XxbzPPnnXrJfZrS0FJwb_EAhIu2VY5i7rGyUThtNLh4';
export let invalidSignedAuthToken    = 'fakebGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.fakec2VybmFtZSI6ImJvYiIsImlhdCI6MTUwMjYyNTIxMywiZXhwIjoxNTAyNzExNjEzfQ.fakemYcOOjM9bzmS4UYRvlWSk_lm3WGHvclmFjLbyOk';

export async function resolveAfterTimeout(duration, value) {
    await wait(duration);
    return value;
}

export function destroyTestCase(client: TGClientSocket, server: TGSocketServer): void
{
    if (server)
    {
        server.close();
        server.httpServer.close();
    }
    if (client)
    {
        if (client.state !== client.CLOSED)
        {
            client.closeAllListeners();
            client.disconnect();
        }
    }
}

export function connectionHandler(socket, allowedUsers, server) {
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