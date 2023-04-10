import WebCrypto from 'topgun-webcrypto';
import { toHEX } from "../utils";

const crypto = WebCrypto;

export function randomBytes(
    randomBytesLength = 9,
    callback?: (error: Error, bytes: Uint8Array) => void
): string {
    let randomBytes = new Uint8Array(randomBytesLength);

    try {
        crypto.getRandomValues(randomBytes);
        if (callback) {
            callback(null, randomBytes);
        }
        return toHEX(randomBytes); // btoa(String.fromCharCode(...randomBytes));
    } catch (e) {
        if (callback) {
            callback(e, randomBytes);
        }
        return null;
    }
}
