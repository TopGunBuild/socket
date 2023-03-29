function bufferFrom(...props: any[])
{
    if (!Object.keys(arguments).length)
    {
        throw new TypeError(
            'First argument must be a string, Buffer, ArrayBuffer, Array, or array-like object.'
        )
    }
    const input = arguments[0];
    let buf;
    if (typeof input === 'string')
    {
        const enc = arguments[1] || 'utf8';
        if (enc === 'hex')
        {
            const bytes = (<any>input)
                .match(/([\da-fA-F]{2})/g)
                .map((byte: string) => parseInt(byte, 16));
            if (!bytes || !bytes.length)
            {
                throw new TypeError('Invalid first argument for type \'hex\'.')
            }
            buf = Array.from(bytes)
        }
        else if (enc === 'utf8')
        {
            const length = input.length;
            const words  = new Uint16Array(length);
            for (let i = 0; i < length; i++)
            {
                words[i] = input.charCodeAt(i)
            }
            buf = Array.from(words)
        }
        else if (enc === 'base64')
        {
            const dec    = atob(input);
            const length = dec.length;
            const bytes  = new Uint8Array(length);
            for (let i = 0; i < length; i++)
            {
                bytes[i] = dec.charCodeAt(i)
            }
            buf = Array.from(bytes)
        }
        else if (enc === 'binary')
        {
            buf = Array.from(input)
        }
        else
        {
            console.info('SafeBuffer.from unknown encoding: ' + enc)
        }
        return buf
    }
    const length = input.byteLength
        ? input.byteLength
        : input.length
            ? input.length
            : null;

    if (length)
    {
        let buf;
        if (input instanceof ArrayBuffer)
        {
            buf = new Uint8Array(input)
        }
        return Array.from(buf || input)
    }
}
