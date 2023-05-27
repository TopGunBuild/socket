import { create, TGClientSocket, TGSocketClientOptions } from '../../src/client';
import { cleanupTasks } from '../cleanup-tasks';

const PORT_NUMBER = 110;

let client: TGClientSocket, clientOptions: TGSocketClientOptions;

afterEach(async () =>
{
    await cleanupTasks(client);
});

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