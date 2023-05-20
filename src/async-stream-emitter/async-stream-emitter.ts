import { StreamDemux } from '../stream-demux/stream-demux';
import { DemuxedAsyncIterableStream } from '../stream-demux/demuxed-async-iterable-stream';

export class AsyncStreamEmitter<T>
{
    private _listenerDemux: StreamDemux<T>;

    constructor()
    {
        this._listenerDemux = new StreamDemux();
    }

    emit(eventName: string, data?: T): void
    {
        this._listenerDemux.write(eventName, data);
    }

    listener(eventName: string): DemuxedAsyncIterableStream<T>
    {
        return this._listenerDemux.stream(eventName);
    }

    closeListener(eventName: string): void
    {
        this._listenerDemux.close(eventName);
    }

    closeAllListeners(): void
    {
        this._listenerDemux.closeAll();
    }
}
