import * as localStorage from 'localStorage';
import { TGClientSocket } from '../src/client';
import { TGSocketServer } from '../src/server';

// Add to the global scope like in browser.
global.localStorage = localStorage;

export async function cleanupTasks(client: TGClientSocket, server?: TGSocketServer): Promise<void>
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
    if (server)
    {
        cleanupTasks.push(
            (async () =>
            {
                server.httpServer.close();
                await server.close();
            })()
        );
    }
    await Promise.all(cleanupTasks);
}