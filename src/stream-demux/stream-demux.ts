import { DemuxedAsyncIterableStream } from './demuxed-async-iterable-stream';
import { WritableAsyncIterableStream } from './writable-async-iterable-stream';

interface StreamDemuxValue<T> {
    name?: string;
    data: { value: T; done?: boolean };
}

export class StreamDemux<T>
{
    private readonly _mainStream: WritableAsyncIterableStream<StreamDemuxValue<T>>;

    /**
     * Constructor
     */
    constructor()
    {
        this._mainStream = new WritableAsyncIterableStream<StreamDemuxValue<T>>();
    }

    // -----------------------------------------------------------------------------------------------------
    // @ Public methods
    // -----------------------------------------------------------------------------------------------------

    write(streamName: string, value: T): void
    {
        this._write(streamName, value, false);
    }

    close(streamName: string, value?: T): void
    {
        this._write(streamName, value, true);
    }

    closeAll(): void
    {
        this._mainStream.close();
    }

    createAsyncIterator(name: string, timeout?: number): AsyncIterator<T>
    {
        const mainStreamIterator = this._mainStream.createAsyncIterator(timeout);
        return {
            next: async () =>
            {
                while (true)
                {
                    const packet = await mainStreamIterator.next();
                    if (packet.done)
                    {
                        return packet;
                    }
                    if (packet.value.name === name)
                    {
                        return packet.value.data;
                    }
                }
            }
        }
    }

    stream(streamName: string): DemuxedAsyncIterableStream<T>
    {
        return new DemuxedAsyncIterableStream(this, streamName);
    }

    // -----------------------------------------------------------------------------------------------------
    // @ Private methods
    // -----------------------------------------------------------------------------------------------------

    private _write(name: string, value: T, done?: boolean): void
    {
        this._mainStream.write({
            name,
            data: { value, done }
        });
    }
}
