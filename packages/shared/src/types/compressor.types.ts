// packages/shared/types/compressor.types.ts
// Context Compressor — Hermes-style sliding window compression

export interface ConversationMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
}

export interface CompressorConfig {
  preserveStart: number;       // default 3
  preserveEnd: number;         // default 5
  triggerTokenThreshold: number; // default 8000
  triggerMessageThreshold: number; // default 20
  ollamaUrl: string;
  ollamaModel: string;         // e.g., llama3.2:3b
  timeoutMs: number;           // default 30000
}

export interface CompressedSummary {
  decisions: string[];
  filesMentioned: string[];
  codeChanges: string[];
  unresolvedQuestions: string[];
  keyFacts: string[];
}

export function getDefaultCompressorConfig(): CompressorConfig {
  return {
    preserveStart: 3,
    preserveEnd: 5,
    triggerTokenThreshold: 8000,
    triggerMessageThreshold: 20,
    ollamaUrl: process.env['OLLAMA_URL'] || 'http://localhost:11434',
    ollamaModel: process.env['OLLAMA_COMPRESSOR_MODEL'] || 'llama3.2:3b',
    timeoutMs: 30000,
  };
}
