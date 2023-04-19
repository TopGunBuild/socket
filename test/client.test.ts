import { ClientOptions, create as createClient, TGClientSocket } from '../src/socket-client';
import { wait } from '../src/utils/wait';
import { AGClientSocket, create as createSocketClient } from 'socketcluster-client';

const PORT_NUMBER = 8009;

let clientOptions: ClientOptions, serverOptions, server, client: TGClientSocket;

describe('Creation', () =>
{
    it('Should automatically connect socket on creation by default', async () =>
    {
        clientOptions = {
            hostname: '127.0.0.1',
            port    : PORT_NUMBER
        };

        client = createClient(clientOptions);
        expect(client.state).toBe(TGClientSocket.CONNECTING);
    });

    it('Should not automatically connect socket if autoConnect is set to false', async () =>
    {
        clientOptions = {
            hostname   : '127.0.0.1',
            port       : PORT_NUMBER,
            autoConnect: false
        };

        client = createClient(clientOptions);
        expect(client.state).toBe(TGClientSocket.CLOSED);
    });
});

describe('Errors', () =>
{
    it('Should be able to emit the error event locally on the socket', async () =>
    {
        // client = createSocketClient(clientOptions);
        client = createClient(clientOptions);
        let err = null;

        (async () => {
            for await (let {error} of client.listener('error')) {
                err = error;
                console.log('1', error);
            }
        })();

        (async () => {
            for await (let status of client.listener('connect')) {
                let error = new Error('Custom error');
                error.name = 'CustomError';
                client.emit('error', {error});
                console.log('2', error);
            }
        })();

        await wait(100);

        expect(err).not.toEqual(null);
        expect(err.name).toBe('SocketProtocolError');
    });
});


