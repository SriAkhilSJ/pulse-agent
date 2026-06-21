// packages/shared/types/cost.types.ts
// Cost Controls — hard caps, real-time counting, user visibility

export interface CostConfig {
  maxTokensPerSession: number;
  maxTokensPerMessage: number;
  maxCostPerSession: number;
  maxCostPerDay: number;
  maxIterationsPerSession: number;
  warnAtTokenThreshold: number;
  warnAtCostThreshold: number;
}

export interface CostState {
  sessionId: string;
  tokensInput: number;
  tokensOutput: number;
  totalTokens: number;
  cost: number;
  iterations: number;
  startedAt: number;
  lastActivityAt: number;
}

export interface CostCheckResult {
  allowed: boolean;
  reason?: string;
  remainingTokens: number;
  remainingCost: number;
  usagePercent: number;
}

export function getDefaultCostConfig(): CostConfig {
  return {
    maxTokensPerSession: parseInt(process.env['MAX_TOKENS_SESSION'] || '100000', 10),
    maxTokensPerMessage: parseInt(process.env['MAX_TOKENS_MESSAGE'] || '8000', 10),
    maxCostPerSession: parseFloat(process.env['MAX_COST_SESSION'] || '5.0'),
    maxCostPerDay: parseFloat(process.env['MAX_COST_DAY'] || '50.0'),
    maxIterationsPerSession: parseInt(process.env['MAX_ITERATIONS'] || '50', 10),
    warnAtTokenThreshold: 0.8,
    warnAtCostThreshold: 0.8,
  };
}
