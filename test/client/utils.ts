import { TGSocket, TGSocketServer } from '../../src/server';

export const TOKEN_EXPIRY_IN_SECONDS = 60 * 60 * 24 * 366 * 5000;

export const validSignedAuthTokenBob  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VybmFtZSI6ImJvYiIsImV4cCI6MzE2Mzc1ODk3ODIxNTQ4NywiaWF0IjoxNTAyNzQ3NzQ2fQ.GLf_jqi_qUSCRahxe2D2I9kD8iVIs0d4xTbiZMRiQq4';
export const validSignedAuthTokenKate = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VybmFtZSI6ImthdGUiLCJleHAiOjMxNjM3NTg5NzgyMTU0ODcsImlhdCI6MTUwMjc0Nzc5NX0.Yfb63XvDt9Wk0wHSDJ3t7Qb1F0oUVUaM5_JKxIE2kyw';
export const invalidSignedAuthToken   = 'fakebGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.fakec2VybmFtZSI6ImJvYiIsImlhdCI6MTUwMjYyNTIxMywiZXhwIjoxNTAyNzExNjEzfQ.fakemYcOOjM9bzmS4UYRvlWSk_lm3WGHvclmFjLbyOk';

const allowedUsers = {
    bob  : true,
    kate : true,
    alice: true
};

export function connectionHandler(socket: TGSocket, server: TGSocketServer): void
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

export async function handleServerConnection(server: TGSocketServer): Promise<void>
{
    for await (let { socket } of server.listener('connection'))
    {
        connectionHandler(socket, server);
    }
}
