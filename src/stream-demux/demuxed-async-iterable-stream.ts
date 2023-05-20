import { AsyncIterableStream } from './async-iterable-stream';
import { StreamDemux } from './stream-demux';

export class DemuxedAsyncIterableStream<T> extends AsyncIterableStream<T>
{
    readonly name: string;
    private readonly _streamDemux: StreamDemux<T>;

    constructor(streamDemux: StreamDemux<T>, name: string)
    {
        super();
        this.name         = name;
        this._streamDemux = streamDemux;
    }

    createAsyncIterator(timeout?: number): AsyncIterator<T>
    {
        return this._streamDemux.createAsyncIterator(this.name, timeout);
    }
}