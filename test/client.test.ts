import { ClientOptions, create as createClient, TGClientSocket } from '../src/socket-client';

const PORT_NUMBER = 8009;

let clientOptions: ClientOptions, serverOptions, server, client: TGClientSocket;

describe('Client', () =>
{
    it('Should automatically connect socket on creation by default', async () =>
    {
        clientOptions = {
            hostname: '127.0.0.1',
            port: PORT_NUMBER
        };

        client = createClient(clientOptions);

        expect(client.state).toBe(TGClientSocket.CONNECTING);
    });
});


