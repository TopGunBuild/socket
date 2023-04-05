import { JwtPayload } from "../jwt";

export interface AuthToken extends JwtPayload {
  [x: string]: any;
}

export interface EventObject {
  event: string;
  data: any;
  callback?: EventObjectCallback | undefined;
  cid?: number | undefined;
  timeout?: any;
  rid?: any;
  error?: any;
  authToken?: any;
  authError?: any;
}

export type EventObjectCallback = (error: Error, eventObject: EventObject) => void;

export interface UnsubscribeData {
  channel: string;
}
