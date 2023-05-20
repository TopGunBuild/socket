import { dehydrateError, InvalidActionError } from '../errors';

export interface IResponseData
{
    rid: any;
    data?: any;
    error?: any;
}

export class TGResponse
{
    socket: any;
    id: number;
    sent: boolean;

    /**
     * Constructor
     */
    constructor(socket: any, id: number)
    {
        this.socket = socket;
        this.id     = id;
        this.sent   = false;
    }

    end(data?: any, options?: any): void
    {
        if (this.id)
        {
            const responseData: IResponseData = {
                rid: this.id
            };
            if (data !== undefined)
            {
                responseData.data = data;
            }
            this._respond(responseData, options);
        }
    }

    error(error: Error, data?: any, options?: any): void
    {
        if (this.id)
        {
            const err = dehydrateError(error);

            const responseData: IResponseData = {
                rid  : this.id,
                error: err
            };
            if (data !== undefined)
            {
                responseData.data = data;
            }

            this._respond(responseData, options);
        }
    }

    callback(error?: any, data?: any, options?: any): void
    {
        if (error)
        {
            this.error(error, data, options);
        }
        else
        {
            this.end(data, options);
        }
    }

    private _respond(responseData: IResponseData, options?): void
    {
        if (this.sent)
        {
            throw new InvalidActionError(`Response ${this.id} has already been sent`);
        }
        else
        {
            this.sent = true;
            this.socket.sendObject(responseData, options);
        }
    }
}
