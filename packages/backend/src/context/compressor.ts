// packages/backend/src/context/compressor.ts
// Context compression — Hermes-style sliding window
// Stores: [Start of conversation]
// Compresses: [Middle of conversation -> dense summary]
// Preserves: [End of conversation (most recent)]

import type { Message } from '@pulse-ide/shared';
import { config } from '../config.js';

export class ContextCompressor {
  private compressedSummary: string = '';

  /**
   * Compress messages that exceed the threshold.
   * Keeps the first system prompt, compresses the middle, preserves the last N messages.
   */
  compress(messages: Message[]): Message[] {
    if (messages.length <= config.historyKeepRecent + 1) {
      return messages; // No compression needed
    }

    const systemMsg = messages[0];
    if (systemMsg.role !== 'system') return messages;

    // Keep last N messages intact
    const recentMessages = messages.slice(-config.historyKeepRecent);
    const middleMessages = messages.slice(1, -config.historyKeepRecent);

    if (middleMessages.length === 0) return messages;

    // Build a dense summary of the middle
    const summaryLines: string[] = [];
    if (this.compressedSummary) {
      summaryLines.push(this.compressedSummary);
    }

    for (const msg of middleMessages) {
      if (msg.role === 'user') {
        summaryLines.push('User: ' + (msg.content || '').substring(0, 200));
      } else if (msg.role === 'assistant' && msg.content) {
        summaryLines.push('Assistant: ' + msg.content.substring(0, 300));
      } else if (msg.role === 'tool') {
        summaryLines.push('Tool result: ' + (msg.content || '').substring(0, 100));
      }
    }

    this.compressedSummary = summaryLines.slice(-config.historyCompressSummaryLines).join('\n');

    return [
      systemMsg,
      { role: 'user' as const, content: '[Previous conversation summary]\n' + this.compressedSummary },
      ...recentMessages,
    ];
  }

  reset(): void {
    this.compressedSummary = '';
  }
}
