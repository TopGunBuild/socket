import { InvalidArgumentsError } from "../errors";
import { getGlobal } from "../utils/global";
import { uuidv4 } from "../utils/uuidv4";
import { TGClientSocket } from "./clientsocket";
import { ClientOptions } from "./types";

const global = getGlobal();

function isUrlSecure(): boolean {
    return global.location && location.protocol === "https:";
}

function getPort(options: ClientOptions, isSecureDefault?: boolean): number {
    let isSecure = options.secure == null ? isSecureDefault : options.secure;
    return (
        options.port ||
        (global.location && location.port
            ? parseFloat(location.port)
            : isSecure
            ? 443
            : 80)
    );
}

export function create(options: ClientOptions): TGClientSocket {
    options = options || {};

    if (options.host && !options.host.match(/[^:]+:\d{2,5}/)) {
        throw new InvalidArgumentsError(
            "The host option should include both" +
                ' the hostname and the port number in the format "hostname:port"'
        );
    }

    if (options.host && options.hostname) {
        throw new InvalidArgumentsError(
            "The host option should already include" +
                ' the hostname and the port number in the format "hostname:port"' +
                " - Because of this, you should never use host and hostname options together"
        );
    }

    if (options.host && options.port) {
        throw new InvalidArgumentsError(
            "The host option should already include" +
                ' the hostname and the port number in the format "hostname:port"' +
                " - Because of this, you should never use host and port options together"
        );
    }

    let isSecureDefault = isUrlSecure();

    let opts: ClientOptions = {
        clientId: uuidv4(),
        port: getPort(options, isSecureDefault),
        hostname: (global.location && location.hostname) || "localhost",
        secure: isSecureDefault,
    };

    Object.assign(opts, options);

    return new TGClientSocket(opts);
}
