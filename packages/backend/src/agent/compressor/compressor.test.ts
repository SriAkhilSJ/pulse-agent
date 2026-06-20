// packages/backend/src/agent/compressor/compressor.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Compressor } from './compressor.js';
import type { ConversationMessage, CompressorConfig } from '@pulse-ide/shared';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

const DEFAULT_CONFIG: CompressorConfig = {
  preserveStart: 3,
  preserveEnd: 5,
  triggerTokenThreshold: 8000,
  triggerMessageThreshold: 20,
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: 'llama3.2:3b',
  timeoutMs: 30000,
};

// Helper to generate a long conversation
function generateLongConversation(numMessages: number): ConversationMessage[] {
  const messages: ConversationMessage[] = [];

  // System prompt
  messages.push({
    role: 'system',
    content: 'You are PulseCode AI, an autonomous coding assistant.',
  });

  // Generate alternating user/assistant messages
  for (let i = 0; i < numMessages - 1; i++) {
    if (i % 2 === 0) {
      messages.push({
        role: 'user',
        content: `User message ${i + 1}: Help me with task ${i + 1} in file${i}.ts`,
      });
    } else {
      messages.push({
        role: 'assistant',
        content: `Assistant response ${i + 1}: I've modified file${i}.ts with the following changes...`,
      });
    }
  }

  return messages;
}

describe('Compressor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('short conversations', () => {
    it('should return unchanged when below message threshold', async () => {
      const messages: ConversationMessage[] = [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ];

      const compressor = new Compressor(DEFAULT_CONFIG);
      const result = await compressor.compress(messages);

      expect(result).toEqual(messages);
      expect(result.length).toBe(3);
    });

    it('should return unchanged when below token threshold', async () => {
      // 10 messages but very short content
      const messages: ConversationMessage[] = Array.from({ length: 10 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' as const : 'assistant' as const,
        content: 'Hi',
      }));

      const compressor = new Compressor(DEFAULT_CONFIG);
      const result = await compressor.compress(messages);

      expect(result).toEqual(messages);
    });
  });

  describe('long conversations', () => {
    it('should trigger compression and return head + summary + tail', async () => {
      const messages = generateLongConversation(25);

      // Mock Ollama response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          response: JSON.stringify({
            decisions: ['Decided to refactor auth.ts', 'Will use JWT for authentication'],
            filesMentioned: ['auth.ts', 'config.ts', 'user.ts'],
            codeChanges: ['Renamed user to customer', 'Added JWT token validation'],
            unresolvedQuestions: ['Should we support OAuth?'],
            keyFacts: ['Important: using deepseek-r1:14b model', 'Note: no API keys needed'],
          }),
        }),
      } as any);

      const compressor = new Compressor(DEFAULT_CONFIG);
      const result = await compressor.compress(messages);

      // Should have: 3 head + 1 summary + 5 tail = 9 messages
      expect(result.length).toBe(9);
      expect(result[0].content).toBe('You are PulseCode AI, an autonomous coding assistant.');
      expect(result[1].role).toBe('user');
      expect(result[2].role).toBe('assistant');

      // Middle should be the compressed summary
      const summaryMessage = result[3];
      expect(summaryMessage.role).toBe('system');
      expect(summaryMessage.content).toContain('Compressed conversation summary');
      expect(summaryMessage.content).toContain('decisions');
      expect(summaryMessage.content).toContain('filesMentioned');
      expect(summaryMessage.content).toContain('auth.ts');

      // Tail should be the last 5 messages
      expect(result.slice(-5)).toEqual(messages.slice(-5));

      // Verify fetch was called
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:11434/api/generate',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });

    it('should preserve exact head and tail messages', async () => {
      const messages = generateLongConversation(30);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          response: JSON.stringify({
            decisions: [],
            filesMentioned: [],
            codeChanges: [],
            unresolvedQuestions: [],
            keyFacts: [],
          }),
        }),
      } as any);

      const compressor = new Compressor(DEFAULT_CONFIG);
      const result = await compressor.compress(messages);

      // First 3 should be identical
      for (let i = 0; i < 3; i++) {
        expect(result[i]).toEqual(messages[i]);
      }

      // Last 5 should be identical
      for (let i = 0; i < 5; i++) {
        expect(result[result.length - 5 + i]).toEqual(messages[messages.length - 5 + i]);
      }
    });
  });

  describe('Ollama failure fallback', () => {
    it('should fall back to rule-based summary when Ollama fails', async () => {
      const messages: ConversationMessage[] = [
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'Help me with auth.ts' },
        { role: 'assistant', content: 'I will refactor auth.ts to use JWT.' },
        ...Array.from({ length: 10 }, (_, i) => ({
          role: 'user' as const,
          content: `We decided to change file${i}.ts. Important: remember to use strict mode.`,
        })),
        ...Array.from({ length: 10 }, (_, i) => ({
          role: 'assistant' as const,
          content: `Edited file${i}.ts. Updated the code.`,
        })),
        { role: 'user', content: 'Should we add tests?' },
        { role: 'assistant', content: 'Yes, let me add tests.' },
        { role: 'user', content: 'Great, thanks!' },
        { role: 'assistant', content: 'Done!' },
        { role: 'user', content: 'What about error handling?' },
        { role: 'assistant', content: 'Already handled.' },
        { role: 'user', content: 'Perfect.' },
        { role: 'assistant', content: 'Task complete.' },
      ];

      // Mock Ollama failure
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      const compressor = new Compressor(DEFAULT_CONFIG);
      const result = await compressor.compress(messages);

      // Should still compress successfully
      expect(result.length).toBeLessThan(messages.length);
      expect(result.length).toBe(3 + 1 + 5); // head + summary + tail

      const summaryMessage = result[3];
      expect(summaryMessage.role).toBe('system');
      expect(summaryMessage.content).toContain('Compressed conversation summary');

      // Rule-based extractor should have found some files
      expect(summaryMessage.content).toContain('file');
    });

    it('should fall back when Ollama returns non-OK status', async () => {
      const messages = generateLongConversation(25);

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      } as any);

      const compressor = new Compressor(DEFAULT_CONFIG);
      const result = await compressor.compress(messages);

      expect(result.length).toBe(9); // Still compressed
      expect(result[3].role).toBe('system');
      expect(result[3].content).toContain('Compressed');
    });

    it('should fall back when Ollama returns invalid JSON', async () => {
      const messages = generateLongConversation(25);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          response: 'This is not valid JSON at all',
        }),
      } as any);

      const compressor = new Compressor(DEFAULT_CONFIG);
      const result = await compressor.compress(messages);

      expect(result.length).toBe(9);
      expect(result[3].content).toContain('Compressed');
    });
  });

  describe('compressSync', () => {
    it('should compress synchronously using rule-based fallback', () => {
      const messages = generateLongConversation(25);

      const compressor = new Compressor(DEFAULT_CONFIG);
      const result = compressor.compressSync(messages);

      expect(result.length).toBe(9);
      expect(result[3].role).toBe('system');
      expect(result[3].content).toContain('Compressed conversation summary');
    });

    it('should return unchanged for short conversations', () => {
      const messages: ConversationMessage[] = [
        { role: 'system', content: 'System' },
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi' },
      ];

      const compressor = new Compressor(DEFAULT_CONFIG);
      const result = compressor.compressSync(messages);

      expect(result).toEqual(messages);
    });
  });

  describe('custom config', () => {
    it('should respect custom preserveStart and preserveEnd', async () => {
      const messages = generateLongConversation(30);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          response: JSON.stringify({
            decisions: [],
            filesMentioned: [],
            codeChanges: [],
            unresolvedQuestions: [],
            keyFacts: [],
          }),
        }),
      } as any);

      const compressor = new Compressor({
        ...DEFAULT_CONFIG,
        preserveStart: 1,
        preserveEnd: 2,
      });
      const result = await compressor.compress(messages);

      // 1 head + 1 summary + 2 tail = 4
      expect(result.length).toBe(4);
      expect(result[0]).toEqual(messages[0]);
      expect(result.slice(-2)).toEqual(messages.slice(-2));
    });

    it('should respect custom thresholds', async () => {
      const messages = generateLongConversation(15);

      // With high threshold, should not compress
      const compressor = new Compressor({
        ...DEFAULT_CONFIG,
        triggerMessageThreshold: 100,
        triggerTokenThreshold: 50000,
      });
      const result = await compressor.compress(messages);

      expect(result.length).toBe(messages.length);
    });
  });
});
