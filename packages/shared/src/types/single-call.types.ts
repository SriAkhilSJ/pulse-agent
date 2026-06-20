// packages/shared/types/single-call.types.ts
// Single-Call Agent types — raw HTTP, no SDK

export interface SingleCallConfig {
  provider: 'ollama' | 'openai' | 'deepseek' | 'custom';
  endpoint: string;        // e.g., https://thickety-jessenia-unaverred.ngrok-free.dev/api/chat
  apiKey: string;          // empty string for Ollama/no-auth
  model: string;           // e.g., deepseek-r1:14b, o1-mini
  maxRetries: number;      // default 3
  timeoutMs: number;       // default 60000
  temperature: number;     // default 0.1
}

export interface SingleCallRequest {
  query: string;
  filePath: string;
  fileContent: string;
  context?: string;        // optional project context/summary
}

export interface SingleCallResponse {
  success: boolean;
  filePath: string;
  diff: string;            // unified diff
  explanation?: string;
  error?: string;
  retries: number;
  duration: number;        // ms
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMResponse {
  content: string;
  model: string;
  duration: number;
}
