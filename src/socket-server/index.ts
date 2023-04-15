import { TGServerSocketGateway } from "./server";
import { TGServerSocketGatewayOptions } from "./types";

export * from "./action";
export * from "./server";
export * from "./server-socket";
export * from "./types";

/**
 * Captures upgrade requests for a http.Server.
 */
export function attach(server: any, options?: TGServerSocketGatewayOptions) {
    options = options || {};
    options.httpServer = server;
    return new TGServerSocketGateway(options);
}
