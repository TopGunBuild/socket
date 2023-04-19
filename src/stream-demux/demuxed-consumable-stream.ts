import {
    ConsumableStream,
    ConsumableStreamConsumer,
} from '../consumable-stream';
import { StreamDemux } from './index';

export class DemuxedConsumableStream<T> extends ConsumableStream<T>
{
    name: string;
    private _streamDemux: StreamDemux<T>;

    /**
     * Constructor
     */
    constructor(streamDemux: StreamDemux<T>, name: string)
    {
        super();
        this.name = name;
        this._streamDemux = streamDemux;
    }

    createConsumer(timeout?: number): ConsumableStreamConsumer<T>
    {
        return this._streamDemux.createConsumer(this.name, timeout) as ConsumableStreamConsumer<T>;
    }
}
