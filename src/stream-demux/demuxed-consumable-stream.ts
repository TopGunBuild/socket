import { ConsumableStream, ConsumableStreamConsumer } from '../consumable-stream';

export class DemuxedConsumableStream<T> extends ConsumableStream<T>
{
    name: string;
    private _streamDemux: any;

    /**
     * Constructor
     */
    constructor(streamDemux, name)
    {
        super();
        this.name         = name;
        this._streamDemux = streamDemux;
    }

    createConsumer(timeout?: number): ConsumableStreamConsumer<T>
    {
        return this._streamDemux.createConsumer(this.name, timeout);
    }
}
