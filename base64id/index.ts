import { randomBytes } from '../crypto/crypto';

export class Base64Id
{
    private bytesBufferIndex: number;
    private bytesBuffer: Uint8Array = null;
    private isGeneratingBytes: boolean;

    getRandomBytes(bytes: number)
    {
        const BUFFER_SIZE = 4096;

        bytes = bytes || 12;

        if (bytes > BUFFER_SIZE)
        {
            return randomBytes(bytes);
        }

        const bytesInBuffer = parseInt(`${BUFFER_SIZE / bytes}`);
        const threshold     = parseInt(`${bytesInBuffer * 0.85}`);

        if (!threshold)
        {
            return randomBytes(bytes);
        }

        if (this.bytesBufferIndex == null)
        {
            this.bytesBufferIndex = -1;
        }

        if (this.bytesBufferIndex == bytesInBuffer)
        {
            this.bytesBuffer      = null;
            this.bytesBufferIndex = -1;
        }

        // No buffered bytes available or index above threshold
        if (this.bytesBufferIndex == -1 || this.bytesBufferIndex > threshold)
        {

            if (!this.isGeneratingBytes)
            {
                this.isGeneratingBytes = true;
                randomBytes(BUFFER_SIZE, (err, bytes) =>
                {
                    this.bytesBuffer       = bytes;
                    this.bytesBufferIndex  = 0;
                    this.isGeneratingBytes = false;
                });
            }

            // Fall back to sync call when no buffered bytes are available
            if (this.bytesBufferIndex == -1)
            {
                return randomBytes(bytes);
            }
        }

        const result = this.bytesBuffer.slice(bytes * this.bytesBufferIndex, bytes * (this.bytesBufferIndex + 1));
        this.bytesBufferIndex++;

        return result;
    }
}