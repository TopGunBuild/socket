import { dehydrateError, InvalidActionError } from '../sc-errors/errors';
import { AGServerSocket } from '../server/server-socket';

export class AGRequest
{
    readonly id: number;
    socket: AGServerSocket;
    procedure: any;
    data: any;
    sent: boolean;

    constructor(socket: AGServerSocket, id: number, procedureName: string, data: any)
    {
        this.socket    = socket;
        this.id        = id;
        this.procedure = procedureName;
        this.data      = data;
        this.sent      = false;
    }

    end(data?: any, options?: any): void
    {
        let responseData: any = {
            rid: this.id
        };
        if (data !== undefined)
        {
            responseData.data = data;
        }
        this._respond(responseData, options);
    }

    error(error: Error, options?: any): void
    {
        let responseData = {
            rid  : this.id,
            error: dehydrateError(error)
        };
        this._respond(responseData, options);
    }

    private _respond(responseData, options): void
    {
        if (this.sent)
        {
            throw new InvalidActionError(`Response to request ${this.id} has already been sent`);
        }
        this.sent = true;
        this.socket.sendObject(responseData, options);
    }
}