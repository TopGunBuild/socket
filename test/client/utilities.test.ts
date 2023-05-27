import { create, TGClientSocket, TGSocketClientOptions } from '../../src/client';
import { cleanupTasks } from '../cleanup-tasks';

const PORT_NUMBER = 710;
let client: TGClientSocket;

const clientOptions: TGSocketClientOptions = {
    hostname  : '127.0.0.1',
    port      : PORT_NUMBER,
    ackTimeout: 200
};

afterEach(async () =>
{
    await cleanupTasks(client);
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