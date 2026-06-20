// packages/backend/src/agent/router.test.ts
import { describe, it, expect } from 'vitest';
import { route } from './router.js';
import { RouteType } from '@pulse-ide/shared';
import type { RouteContext } from '@pulse-ide/shared';

// Helper to create a default context with overrides
function createContext(overrides: Partial<RouteContext> = {}): RouteContext {
  return {
    query: '',
    currentFileContent: '',
    cursorPosition: 0,
    activeFilePath: '/workspace/src/index.ts',
    workspaceFiles: ['src/index.ts', 'src/utils.ts', 'src/config.ts'],
    recentEdits: [],
    conversationHistoryLength: 0,
    ...overrides,
  };
}

describe('Smart Router', () => {
  describe('AUTOCOMPLETE routing', () => {
    it('should route simple typing to AUTOCOMPLETE', () => {
      const ctx = createContext({
        query: 'const x =',
        currentFileContent: 'const x = \nconst y = 2;',
        cursorPosition: 10, // at end of "const x = "
      });

      const result = route(ctx);

      expect(result.type).toBe(RouteType.AUTOCOMPLETE);
      expect(result.confidence).toBeGreaterThanOrEqual(0.8);
    });

    it('should route short code fragment to AUTOCOMPLETE', () => {
      const ctx = createContext({
        query: 'import {',
        currentFileContent: 'import {\n',
        cursorPosition: 9,
      });

      const result = route(ctx);
      expect(result.type).toBe(RouteType.AUTOCOMPLETE);
    });

    it('should NOT route to AUTOCOMPLETE if query has a question mark', () => {
      const ctx = createContext({
        query: 'how do I fix?',
        currentFileContent: 'how do I fix?\n',
        cursorPosition: 14,
      });

      const result = route(ctx);
      expect(result.type).not.toBe(RouteType.AUTOCOMPLETE);
    });

    it('should NOT route to AUTOCOMPLETE if query is too long', () => {
      const ctx = createContext({
        query: 'const veryLongVariableName = someFunctionCall(with, many, args)',
        currentFileContent: 'const veryLongVariableName = someFunctionCall(with, many, args)\n',
        cursorPosition: 62,
      });

      const result = route(ctx);
      expect(result.type).not.toBe(RouteType.AUTOCOMPLETE);
    });
  });

  describe('SINGLE_CALL routing', () => {
    it('should route specific file fixes to SINGLE_CALL', () => {
      const ctx = createContext({
        query: 'fix the bug in auth.ts?',
      });

      const result = route(ctx);

      expect(result.type).toBe(RouteType.SINGLE_CALL);
      expect(result.confidence).toBeGreaterThanOrEqual(0.8);
    });

    it('should route "update config.ts" to SINGLE_CALL', () => {
      const ctx = createContext({
        query: 'update config.ts to add new setting',
      });

      const result = route(ctx);
      expect(result.type).toBe(RouteType.SINGLE_CALL);
    });

    it('should route short clear instructions to SINGLE_CALL', () => {
      const ctx = createContext({
        query: 'fix the typo in the readme',
      });

      const result = route(ctx);
      expect(result.type).toBe(RouteType.SINGLE_CALL);
    });

    it('should route "add error handling to api.ts" to SINGLE_CALL', () => {
      const ctx = createContext({
        query: 'add error handling to api.ts',
      });

      const result = route(ctx);
      expect(result.type).toBe(RouteType.SINGLE_CALL);
    });
  });

  describe('MULTI_CALL routing', () => {
    it('should route complex refactors to MULTI_CALL', () => {
      const ctx = createContext({
        query: 'implement a new login system with jwt',
      });

      const result = route(ctx);

      expect(result.type).toBe(RouteType.MULTI_CALL);
    });

    it('should route "refactor" keyword to MULTI_CALL', () => {
      const ctx = createContext({
        query: 'refactor the authentication module',
      });

      const decision = route(ctx);
      expect(decision.type).toBe(RouteType.MULTI_CALL);
    });

    it('should route "search codebase" to MULTI_CALL', () => {
      const ctx = createContext({
        query: 'search codebase for all usages of deprecated API',
      });

      const result = route(ctx);
      expect(result.type).toBe(RouteType.MULTI_CALL);
    });

    it('should route ambiguous queries in large workspaces to MULTI_CALL', () => {
      const ctx = createContext({
        query: 'improve the overall code quality and structure of the application',
        workspaceFiles: Array.from({ length: 50 }, (_, i) => `src/file${i}.ts`),
      });

      const result = route(ctx);
      expect(result.type).toBe(RouteType.MULTI_CALL);
    });

    it('should default to MULTI_CALL for unknown queries', () => {
      const ctx = createContext({
        query: 'hello',
      });

      const result = route(ctx);
      expect(result.type).toBe(RouteType.MULTI_CALL);
      expect(result.confidence).toBe(0.5);
    });
  });

  describe('RouteDecision structure', () => {
    it('should return a decision with type, reason, and confidence', () => {
      const ctx = createContext({ query: 'const x =' });
      const result = route(ctx);

      expect(result).toHaveProperty('type');
      expect(result).toHaveProperty('reason');
      expect(result).toHaveProperty('confidence');
      expect(typeof result.reason).toBe('string');
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });
  });
});
