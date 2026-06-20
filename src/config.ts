// src/config.ts
// Centralized configuration — ALL values from .env with sensible defaults.

export const config = {
  // Agent
  maxIterations: parseInt(process.env['PULSE_MAX_ITERATIONS'] || '100', 10) || 100,
  maxCallsPerSession: parseInt(process.env['PULSE_MAX_CALLS_PER_SESSION'] || '100', 10) || 100,
  streaming: (process.env['PULSE_STREAMING'] || 'true').toLowerCase() === 'true',
  maxRetries: parseInt(process.env['PULSE_MAX_RETRIES'] || '3', 10) || 3,
  retryBaseDelayMs: parseInt(process.env['PULSE_RETRY_BASE_DELAY'] || '2000', 10) || 2000,
  llmTimeoutMs: parseInt(process.env['PULSE_LLM_TIMEOUT'] || '300000', 10) || 300_000,
  maxToolResultChars: parseInt(process.env['PULSE_MAX_TOOL_RESULT_CHARS'] || '4000', 10) || 4000,

  // Context engine
  contextMaxFiles: parseInt(process.env['PULSE_CONTEXT_MAX_FILES'] || '50000', 10) || 50_000,
  contextBatchSize: parseInt(process.env['PULSE_CONTEXT_BATCH_SIZE'] || '50', 10) || 50,

  // Flow state
  flowMaxActions: parseInt(process.env['PULSE_FLOW_MAX_ACTIONS'] || '50', 10) || 50,

  // Inline suggestions
  inlineDebounceMs: parseInt(process.env['PULSE_INLINE_DEBOUNCE'] || '500', 10) || 500,

  // Sub-agents
  subagentMaxAgeMs: parseInt(process.env['PULSE_SUBAGENT_MAX_AGE'] || '300000', 10) || 300_000,

  // Session DB
  sessionCleanupIntervalMs: parseInt(process.env['PULSE_SESSION_CLEANUP_INTERVAL'] || '60000', 10) || 60_000,
  sessionMaxStale: parseInt(process.env['PULSE_SESSION_MAX_STALE'] || '100', 10) || 100,

  // File tools
  fileCacheTtlMs: parseInt(process.env['PULSE_FILE_CACHE_TTL'] || '30000', 10) || 30_000,

  // Web fetch
  webFetchTimeoutMs: parseInt(process.env['PULSE_WEB_FETCH_TIMEOUT'] || '15000', 10) || 15_000,
  webSearchTimeoutMs: parseInt(process.env['PULSE_WEB_SEARCH_TIMEOUT'] || '15000', 10) || 15_000,
  webSearchMaxResults: parseInt(process.env['PULSE_WEB_SEARCH_MAX_RESULTS'] || '5', 10) || 5,
  webSearchMaxRetries: parseInt(process.env['PULSE_WEB_SEARCH_MAX_RETRIES'] || '2', 10) || 2,

  // Memory
  memoryMaxEntries: parseInt(process.env['PULSE_MEMORY_MAX_ENTRIES'] || '100', 10) || 100,
  memoryMaxContentChars: parseInt(process.env['PULSE_MEMORY_MAX_CONTENT'] || '2000', 10) || 2000,
  memoryLlmTimeoutMs: parseInt(process.env['PULSE_MEMORY_LLM_TIMEOUT'] || '10000', 10) || 10_000,

  // Terminal
  terminalTimeoutMs: parseInt(process.env['PULSE_TERMINAL_TIMEOUT'] || '60000', 10) || 60_000,

  // LLM request
  maxTokens: parseInt(process.env['PULSE_MAX_TOKENS'] || '8192', 10) || 8192,

  // Browser tools
  browserTimeoutMs: parseInt(process.env['PULSE_BROWSER_TIMEOUT'] || '30000', 10) || 30_000,

  // Vision tools
  visionTimeoutMs: parseInt(process.env['PULSE_VISION_TIMEOUT'] || '120000', 10) || 120_000,

  // Image generation
  imageGenTimeoutMs: parseInt(process.env['PULSE_IMAGEGEN_TIMEOUT'] || '300000', 10) || 300_000,
  imageGenPollIntervalMs: parseInt(process.env['PULSE_IMAGEGEN_POLL_INTERVAL'] || '10000', 10) || 10_000,
  imageGenMaxPolls: parseInt(process.env['PULSE_IMAGEGEN_MAX_POLLS'] || '60', 10) || 60,

  // History compression
  historyCompressThreshold: parseInt(process.env['PULSE_HISTORY_COMPRESS_THRESHOLD'] || '60', 10) || 60,
  historyKeepRecent: parseInt(process.env['PULSE_HISTORY_KEEP_RECENT'] || '20', 10) || 20,
  historyCompressSummaryLines: parseInt(process.env['PULSE_HISTORY_COMPRESS_SUMMARY'] || '30', 10) || 30,

  // Cost estimation
  modelInputPrice: parseFloat(process.env['MODEL_INPUT_PRICE'] || '0'),
  modelOutputPrice: parseFloat(process.env['MODEL_OUTPUT_PRICE'] || '0'),
};
