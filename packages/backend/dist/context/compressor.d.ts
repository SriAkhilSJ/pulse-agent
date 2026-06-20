import type { Message } from '@pulse-ide/shared';
export declare class ContextCompressor {
    private compressedSummary;
    /**
     * Compress messages that exceed the threshold.
     * Keeps the first system prompt, compresses the middle, preserves the last N messages.
     */
    compress(messages: Message[]): Message[];
    reset(): void;
}
//# sourceMappingURL=compressor.d.ts.map