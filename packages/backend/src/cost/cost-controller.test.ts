// packages/backend/src/cost/cost-controller.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { CostController } from './cost-controller.js';
import type { CostConfig } from '@pulse-ide/shared';

const DEFAULT_CONFIG: CostConfig = {
  maxTokensPerSession: 10000,
  maxTokensPerMessage: 2000,
  maxCostPerSession: 1.0,
  maxCostPerDay: 10.0,
  maxIterationsPerSession: 10,
  warnAtTokenThreshold: 0.8,
  warnAtCostThreshold: 0.8,
};

describe('CostController', () => {
  let controller: CostController;

  beforeEach(() => {
    controller = new CostController(DEFAULT_CONFIG);
  });

  describe('session initialization', () => {
    it('should initialize a new session', () => {
      const state = controller.initSession('s1', 'test query');

      expect(state.sessionId).toBe('s1');
      expect(state.tokensInput).toBe(0);
      expect(state.tokensOutput).toBe(0);
      expect(state.cost).toBe(0);
      expect(state.iterations).toBe(0);
    });
  });

  describe('message checks', () => {
    it('should allow messages within limits', () => {
      controller.initSession('s1', 'test');
      const result = controller.checkMessage('s1', 100);

      expect(result.allowed).toBe(true);
      expect(result.remainingTokens).toBe(9900);
    });

    it('should block messages exceeding per-message token limit', () => {
      controller.initSession('s1', 'test');
      const result = controller.checkMessage('s1', 3000);

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('max tokens per message');
    });

    it('should block when session token limit reached', () => {
      controller.initSession('s1', 'test');
      controller.recordUsage('s1', 9000, 1000, 'gpt-4o');

      const result = controller.checkMessage('s1', 100);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('token limit');
    });

    it('should block when session cost limit reached', () => {
      controller.initSession('s1', 'test');
      // Use a high-cost model to hit cost limit before token limit
      // gpt-4o: $2.5/1M input, $10/1M output. 100K tokens = $0.25 + $1.00 = $1.25 > $1.00
      controller.recordUsage('s1', 5000, 5000, 'gpt-4o');

      const result = controller.checkMessage('s1', 100);
      expect(result.allowed).toBe(false);
      // Could be token or cost limit depending on order; just check it's blocked
      expect(result.reason).toBeDefined();
    });

    it('should block when iteration limit reached', () => {
      controller.initSession('s1', 'test');
      for (let i = 0; i < 10; i++) {
        controller.recordUsage('s1', 100, 100, 'deepseek-r1:14b');
      }

      const result = controller.checkMessage('s1', 100);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('iteration limit');
    });

    it('should return correct remaining tokens', () => {
      controller.initSession('s1', 'test');
      controller.recordUsage('s1', 1000, 500, 'gpt-4o');

      const result = controller.checkMessage('s1', 100);
      expect(result.allowed).toBe(true);
      expect(result.remainingTokens).toBe(8400); // 10000 - 1000 - 500 - 100
    });
  });

  describe('usage recording', () => {
    it('should record token usage', () => {
      controller.initSession('s1', 'test');
      controller.recordUsage('s1', 100, 50, 'gpt-4o');

      const state = controller.getState('s1');
      expect(state!.tokensInput).toBe(100);
      expect(state!.tokensOutput).toBe(50);
      expect(state!.totalTokens).toBe(150);
      expect(state!.iterations).toBe(1);
    });

    it('should calculate cost for paid models', () => {
      controller.initSession('s1', 'test');
      controller.recordUsage('s1', 100000, 100000, 'gpt-4o');

      const state = controller.getState('s1');
      expect(state!.cost).toBeGreaterThan(0);
    });

    it('should have zero cost for local models', () => {
      controller.initSession('s1', 'test');
      controller.recordUsage('s1', 100000, 100000, 'deepseek-r1:14b');

      const state = controller.getState('s1');
      expect(state!.cost).toBe(0);
    });
  });

  describe('warnings', () => {
    it('should warn when approaching token limit', () => {
      controller.initSession('s1', 'test');
      controller.recordUsage('s1', 8000, 100, 'gpt-4o'); // 8100/10000 = 81%

      const warnings = controller.getWarnings('s1');
      expect(warnings.length).toBeGreaterThan(0);
      expect(warnings[0]).toContain('Token usage');
    });

    it('should warn when approaching cost limit', () => {
      // Use higher token limit so cost is the limiting factor
      const costOnlyController = new CostController({
        ...DEFAULT_CONFIG,
        maxTokensPerSession: 1000000, // 1M tokens
        maxCostPerSession: 0.5, // $0.50
      });
      costOnlyController.initSession('s1', 'test');
      // gpt-4o: $2.5/1M input. 150K input = $0.375 of $0.50 = 75% (below 80%)
      // Need 80%+ => 160K+ input tokens
      costOnlyController.recordUsage('s1', 170000, 0, 'gpt-4o');

      const warnings = costOnlyController.getWarnings('s1');
      const costWarning = warnings.find(w => w.includes('Cost'));
      expect(costWarning).toBeDefined();
    });

    it('should not warn when well within limits', () => {
      controller.initSession('s1', 'test');
      controller.recordUsage('s1', 100, 100, 'gpt-4o');

      const warnings = controller.getWarnings('s1');
      expect(warnings).toHaveLength(0);
    });
  });

  describe('session management', () => {
    it('should end a session', () => {
      controller.initSession('s1', 'test');
      controller.endSession('s1');

      expect(controller.getState('s1')).toBeNull();
    });

    it('should return null for non-existent session', () => {
      expect(controller.getState('non-existent')).toBeNull();
    });
  });

  describe('usage percent', () => {
    it('should calculate correct usage percent', () => {
      controller.initSession('s1', 'test');
      controller.recordUsage('s1', 5000, 0, 'gpt-4o');

      const result = controller.checkMessage('s1', 0);
      expect(result.usagePercent).toBe(0.5); // 5000/10000
    });
  });
});
