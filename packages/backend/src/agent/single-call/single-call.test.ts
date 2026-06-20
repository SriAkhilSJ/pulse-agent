// packages/backend/src/agent/single-call/single-call.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SingleCallAgent, getConfigFromEnv } from './single-call.js';
import { callLLM, LLMError } from './http-client.js';
import type { SingleCallConfig, LLMMessage } from '@pulse-ide/shared';

// Mock the http-client module
vi.mock('./http-client.js', () => ({
  callLLM: vi.fn(),
  LLMError: class LLMError extends Error {
    statusCode?: number;
    responseBody?: string;
    constructor(message: string, statusCode?: number, responseBody?: string) {
      super(message);
      this.name = 'LLMError';
      this.statusCode = statusCode;
      this.responseBody = responseBody;
    }
  },
}));

const MOCK_CONFIG: SingleCallConfig = {
  provider: 'ollama',
  endpoint: 'http://localhost:11434/api/chat',
  apiKey: '',
  model: 'deepseek-r1:14b',
  maxRetries: 3,
  timeoutMs: 30000,
  temperature: 0.1,
};

const MOCK_FILE_CONTENT = `const user = { name: 'test' };
function getUser() {
  return user;
}
export { user, getUser };
`;

describe('SingleCallAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('successful runs', () => {
    it('should return a valid diff for a single-file edit', async () => {
      const mockResponse = {
        content: JSON.stringify({
          filePath: 'auth.ts',
          diff: `--- a/auth.ts
+++ b/auth.ts
@@ -1,3 +1,3 @@
-const user = { name: 'test' };
+const customer = { name: 'test' };
 function getUser() {
-  return user;
+  return customer;
 }`,
          explanation: 'Renamed user to customer',
        }),
        model: 'deepseek-r1:14b',
        duration: 1500,
      };

      (callLLM as any).mockResolvedValue(mockResponse);

      const agent = new SingleCallAgent(MOCK_CONFIG);
      const result = await agent.run({
        query: 'Rename variable user to customer',
        filePath: 'auth.ts',
        fileContent: MOCK_FILE_CONTENT,
      });

      expect(result.success).toBe(true);
      expect(result.filePath).toBe('auth.ts');
      expect(result.diff).toContain('--- a/auth.ts');
      expect(result.diff).toContain('+++ b/auth.ts');
      expect(result.diff).toContain('customer');
      expect(result.explanation).toBe('Renamed user to customer');
      expect(result.retries).toBe(0);
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it('should handle response with markdown code fences', async () => {
      const mockResponse = {
        content: `\`\`\`json
{
  "filePath": "test.ts",
  "diff": "--- a/test.ts\\n+++ b/test.ts\\n@@ -1 +1 @@\\n-old\\n+new",
  "explanation": "Updated test file"
}
\`\`\``,
        model: 'deepseek-r1:14b',
        duration: 800,
      };

      (callLLM as any).mockResolvedValue(mockResponse);

      const agent = new SingleCallAgent(MOCK_CONFIG);
      const result = await agent.run({
        query: 'Update test file',
        filePath: 'test.ts',
        fileContent: 'old',
      });

      expect(result.success).toBe(true);
      expect(result.diff).toContain('--- a/test.ts');
    });
  });

  describe('retry logic', () => {
    it('should retry on malformed JSON and eventually succeed', async () => {
      // First call returns invalid JSON
      (callLLM as any)
        .mockResolvedValueOnce({
          content: 'This is not JSON at all',
          model: 'deepseek-r1:14b',
          duration: 500,
        })
        // Second call returns valid JSON
        .mockResolvedValueOnce({
          content: JSON.stringify({
            filePath: 'auth.ts',
            diff: '--- a/auth.ts\n+++ b/auth.ts\n@@ -1 +1 @@\n-old\n+new',
            explanation: 'Fixed it',
          }),
          model: 'deepseek-r1:14b',
          duration: 800,
        });

      const agent = new SingleCallAgent({ ...MOCK_CONFIG, maxRetries: 3 });
      const result = await agent.run({
        query: 'Fix the bug',
        filePath: 'auth.ts',
        fileContent: 'old content',
      });

      expect(result.success).toBe(true);
      expect(result.retries).toBe(1); // Succeeded on second attempt
      expect(callLLM).toHaveBeenCalledTimes(2);
    });

    it('should retry on empty diff', async () => {
      (callLLM as any)
        .mockResolvedValueOnce({
          content: JSON.stringify({
            filePath: 'test.ts',
            diff: '',
            explanation: 'No changes needed',
          }),
          model: 'deepseek-r1:14b',
          duration: 500,
        })
        .mockResolvedValueOnce({
          content: JSON.stringify({
            filePath: 'test.ts',
            diff: '--- a/test.ts\n+++ b/test.ts\n@@ -1 +1 @@\n-old\n+new',
            explanation: 'Added change',
          }),
          model: 'deepseek-r1:14b',
          duration: 800,
        });

      const agent = new SingleCallAgent({ ...MOCK_CONFIG, maxRetries: 3 });
      const result = await agent.run({
        query: 'Make a change',
        filePath: 'test.ts',
        fileContent: 'old',
      });

      expect(result.success).toBe(true);
      expect(result.retries).toBe(1);
    });

    it('should return error after max retries exceeded', async () => {
      (callLLM as any).mockResolvedValue({
        content: 'Invalid response',
        model: 'deepseek-r1:14b',
        duration: 500,
      });

      const agent = new SingleCallAgent({ ...MOCK_CONFIG, maxRetries: 2 });
      const result = await agent.run({
        query: 'Fix the bug',
        filePath: 'auth.ts',
        fileContent: 'content',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed after 3 attempts');
      expect(result.retries).toBe(2);
      expect(callLLM).toHaveBeenCalledTimes(3); // initial + 2 retries
    });

    it('should not retry on 4xx errors', async () => {
      (callLLM as any).mockRejectedValue(
        new LLMError('Unauthorized', 401, '{"error": "invalid key"}')
      );

      const agent = new SingleCallAgent({ ...MOCK_CONFIG, maxRetries: 3 });
      const result = await agent.run({
        query: 'Fix the bug',
        filePath: 'auth.ts',
        fileContent: 'content',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('401');
      expect(result.error).toContain('Unauthorized');
      expect(callLLM).toHaveBeenCalledTimes(1); // No retries on 4xx
    });

    it('should retry on 5xx errors', async () => {
      (callLLM as any)
        .mockRejectedValueOnce(new LLMError('Server error', 500))
        .mockRejectedValueOnce(new LLMError('Server error', 502))
        .mockResolvedValueOnce({
          content: JSON.stringify({
            filePath: 'test.ts',
            diff: '--- a/test.ts\n+++ b/test.ts\n@@ -1 +1 @@\n-old\n+new',
            explanation: 'Fixed',
          }),
          model: 'deepseek-r1:14b',
          duration: 800,
        });

      const agent = new SingleCallAgent({ ...MOCK_CONFIG, maxRetries: 3 });
      const result = await agent.run({
        query: 'Fix the bug',
        filePath: 'test.ts',
        fileContent: 'old',
      });

      expect(result.success).toBe(true);
      expect(result.retries).toBe(2);
      expect(callLLM).toHaveBeenCalledTimes(3);
    });
  });

  describe('getConfigFromEnv', () => {
    it('should read config from environment variables', () => {
      const originalEnv = { ...process.env };

      process.env['OLLAMA_URL'] = 'https://thickety-jessenia-unaverred.ngrok-free.dev/api/chat';
      process.env['OLLAMA_MODEL'] = 'deepseek-r1:14b';
      process.env['LLM_MAX_RETRIES'] = '5';
      process.env['LLM_TIMEOUT_MS'] = '120000';
      process.env['LLM_TEMPERATURE'] = '0.3';

      const config = getConfigFromEnv();

      expect(config.endpoint).toBe('https://thickety-jessenia-unaverred.ngrok-free.dev/api/chat');
      expect(config.model).toBe('deepseek-r1:14b');
      expect(config.maxRetries).toBe(5);
      expect(config.timeoutMs).toBe(120000);
      expect(config.temperature).toBe(0.3);
      expect(config.apiKey).toBe('');

      // Restore
      process.env = originalEnv;
    });

    it('should use defaults when env vars are not set', () => {
      const originalEnv = { ...process.env };
      delete process.env['OLLAMA_URL'];
      delete process.env['OLLAMA_MODEL'];
      delete process.env['LLM_ENDPOINT'];
      delete process.env['LLM_MODEL'];

      const config = getConfigFromEnv();

      expect(config.endpoint).toBe('http://localhost:11434/api/chat');
      expect(config.model).toBe('deepseek-r1:14b');
      expect(config.maxRetries).toBe(3);
      expect(config.timeoutMs).toBe(60000);
      expect(config.temperature).toBe(0.1);

      process.env = originalEnv;
    });
  });
});
