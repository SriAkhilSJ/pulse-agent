// packages/backend/src/cost/cost-controller.ts
// Cost Controller — hard caps, real-time counting, user visibility

import type { CostConfig, CostState, CostCheckResult } from '@pulse-ide/shared';
import { getDefaultCostConfig } from '@pulse-ide/shared';
import { calculateCost } from '../observability/tracer.js';

// Per-session cost tracking
const sessionStates = new Map<string, CostState>();
// Daily cost tracking
let dailyCost = 0;
let dailyResetTime = Date.now();

export class CostController {
  private config: CostConfig;

  constructor(config?: Partial<CostConfig>) {
    this.config = { ...getDefaultCostConfig(), ...config };
  }

  /** Initialize a new session */
  initSession(sessionId: string, query: string): CostState {
    const now = Date.now();
    const state: CostState = {
      sessionId,
      tokensInput: 0,
      tokensOutput: 0,
      totalTokens: 0,
      cost: 0,
      iterations: 0,
      startedAt: now,
      lastActivityAt: now,
    };
    sessionStates.set(sessionId, state);
    return state;
  }

  /** Check if a new message is allowed */
  checkMessage(sessionId: string, inputTokens: number): CostCheckResult {
    const state = sessionStates.get(sessionId);
    if (!state) {
      return { allowed: false, reason: 'Session not found', remainingTokens: 0, remainingCost: 0, usagePercent: 100 };
    }

    // Reset daily cost if needed
    this.resetDailyIfNeeded();

    // Check per-message token limit
    if (inputTokens > this.config.maxTokensPerMessage) {
      return {
        allowed: false,
        reason: `Message exceeds max tokens per message (${inputTokens} > ${this.config.maxTokensPerMessage})`,
        remainingTokens: this.config.maxTokensPerSession - state.totalTokens,
        remainingCost: this.config.maxCostPerSession - state.cost,
        usagePercent: state.totalTokens / this.config.maxTokensPerSession,
      };
    }

    // Check session token limit
    const projectedTokens = state.totalTokens + inputTokens;
    if (projectedTokens > this.config.maxTokensPerSession) {
      return {
        allowed: false,
        reason: `Session token limit reached (${projectedTokens} > ${this.config.maxTokensPerSession})`,
        remainingTokens: this.config.maxTokensPerSession - state.totalTokens,
        remainingCost: this.config.maxCostPerSession - state.cost,
        usagePercent: state.totalTokens / this.config.maxTokensPerSession,
      };
    }

    // Check session cost limit
    const projectedCost = state.cost + calculateCost('gpt-4o', inputTokens, 0);
    if (projectedCost > this.config.maxCostPerSession) {
      return {
        allowed: false,
        reason: `Session cost limit reached ($${projectedCost.toFixed(4)} > $${this.config.maxCostPerSession})`,
        remainingTokens: this.config.maxTokensPerSession - state.totalTokens,
        remainingCost: this.config.maxCostPerSession - state.cost,
        usagePercent: state.cost / this.config.maxCostPerSession,
      };
    }

    // Check daily cost limit
    if (dailyCost + projectedCost > this.config.maxCostPerDay) {
      return {
        allowed: false,
        reason: `Daily cost limit reached ($${(dailyCost + projectedCost).toFixed(4)} > $${this.config.maxCostPerDay})`,
        remainingTokens: this.config.maxTokensPerSession - state.totalTokens,
        remainingCost: this.config.maxCostPerDay - dailyCost,
        usagePercent: dailyCost / this.config.maxCostPerDay,
      };
    }

    // Check iteration limit
    if (state.iterations >= this.config.maxIterationsPerSession) {
      return {
        allowed: false,
        reason: `Session iteration limit reached (${state.iterations} >= ${this.config.maxIterationsPerSession})`,
        remainingTokens: this.config.maxTokensPerSession - state.totalTokens,
        remainingCost: this.config.maxCostPerSession - state.cost,
        usagePercent: state.iterations / this.config.maxIterationsPerSession,
      };
    }

    return {
      allowed: true,
      remainingTokens: this.config.maxTokensPerSession - projectedTokens,
      remainingCost: this.config.maxCostPerSession - projectedCost,
      usagePercent: projectedTokens / this.config.maxTokensPerSession,
    };
  }

  /** Record token usage after an LLM call */
  recordUsage(sessionId: string, tokensIn: number, tokensOut: number, model: string): void {
    const state = sessionStates.get(sessionId);
    if (!state) return;

    state.tokensInput += tokensIn;
    state.tokensOutput += tokensOut;
    state.totalTokens = state.tokensInput + state.tokensOutput;
    state.cost += calculateCost(model, tokensIn, tokensOut);
    state.iterations++;
    state.lastActivityAt = Date.now();

    dailyCost += calculateCost(model, tokensIn, tokensOut);
  }

  /** Get current session state */
  getState(sessionId: string): CostState | null {
    return sessionStates.get(sessionId) || null;
  }

  /** Check if approaching limits (for warnings) */
  getWarnings(sessionId: string): string[] {
    const warnings: string[] = [];
    const state = sessionStates.get(sessionId);
    if (!state) return warnings;

    const tokenUsage = state.totalTokens / this.config.maxTokensPerSession;
    const costUsage = state.cost / this.config.maxCostPerSession;
    const iterUsage = state.iterations / this.config.maxIterationsPerSession;

    if (tokenUsage >= this.config.warnAtTokenThreshold) {
      warnings.push(`Token usage at ${Math.round(tokenUsage * 100)}% (${state.totalTokens}/${this.config.maxTokensPerSession})`);
    }
    if (costUsage >= this.config.warnAtCostThreshold) {
      warnings.push(`Cost usage at ${Math.round(costUsage * 100)}% ($${state.cost.toFixed(4)}/$${this.config.maxCostPerSession})`);
    }
    if (iterUsage >= this.config.warnAtTokenThreshold) {
      warnings.push(`Iteration usage at ${Math.round(iterUsage * 100)}% (${state.iterations}/${this.config.maxIterationsPerSession})`);
    }

    return warnings;
  }

  /** End a session */
  endSession(sessionId: string): void {
    sessionStates.delete(sessionId);
  }

  /** Get daily cost */
  getDailyCost(): number {
    this.resetDailyIfNeeded();
    return dailyCost;
  }

  /** Reset daily cost if 24h have passed */
  private resetDailyIfNeeded(): void {
    const now = Date.now();
    if (now - dailyResetTime > 24 * 60 * 60 * 1000) {
      dailyCost = 0;
      dailyResetTime = now;
    }
  }
}
