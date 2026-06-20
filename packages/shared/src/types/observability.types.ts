// packages/shared/types/observability.types.ts
// Observability + Semantic Caching types

export interface Trace {
  id: string;
  sessionId: string;
  query: string;
  route: 'autocomplete' | 'single_call' | 'multi_call';
  model: string;
  tokensInput: number;
  tokensOutput: number;
  cost: number;
  durationMs: number;
  success: boolean;
  error?: string;
  steps: StepTrace[];
  timestamp: number;
}

export interface StepTrace {
  type: 'llm' | 'tool' | 'plan' | 'validate' | 'cache';
  name: string;
  input: unknown;
  output: unknown;
  durationMs: number;
  metadata?: Record<string, unknown>;
}

export interface CachedResponse {
  query: string;
  response: string;
  embedding: number[];
  route: string;
  timestamp: number;
  hits: number;
}

export interface CacheConfig {
  dbPath: string;
  maxSize: number;
  similarityThreshold: number;
  ollamaUrl: string;
  ollamaEmbeddingModel: string;
}

export function getDefaultCacheConfig(): CacheConfig {
  return {
    dbPath: process.env['CACHE_DB_PATH'] || './cache.db',
    maxSize: 10000,
    similarityThreshold: 0.95,
    ollamaUrl: process.env['OLLAMA_URL'] || 'http://localhost:11434',
    ollamaEmbeddingModel: process.env['OLLAMA_EMBED_MODEL'] || 'nomic-embed-text',
  };
}
