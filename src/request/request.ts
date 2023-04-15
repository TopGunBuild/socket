import { dehydrateError, InvalidActionError } from '../errors/errors';
import { TGSocket } from './types';

export class TGRequest
{
    readonly id: number;
    socket: TGSocket;
    procedure: any;
    data: any;
    sent: boolean;

    constructor(
        socket: TGSocket,
        id: number,
        procedureName: string,
        data: any
    )
    {
        this.socket    = socket;
        this.id        = id;
        this.procedure = procedureName;
        this.data      = data;
        this.sent      = false;
    }

    end(data?: any, options?: any): void
    {
        const responseData: any = {
            rid: this.id,
        };
        if (data !== undefined)
        {
            responseData.data = data;
        }
        this._respond(responseData, options);
    }

    error(error: Error, options?: any): void
    {
        const responseData = {
            rid  : this.id,
            error: dehydrateError(error),
        };
        this._respond(responseData, options);
    }

    private _respond(responseData: any, options: any): void
    {
        if (this.sent)
        {
            throw new InvalidActionError(
                `Response to request ${this.id} has already been sent`
            );
        }
        this.sent = true;
        this.socket.sendObject(responseData, options);
    }
}
