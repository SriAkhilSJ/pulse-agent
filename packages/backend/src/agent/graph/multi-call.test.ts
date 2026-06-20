// packages/backend/src/agent/graph/multi-call.test.ts
import { describe, it, expect } from 'vitest';
import { runMultiCallAgent, createMultiCallAgent, validateOutput } from './multi-call.js';
import type { AgentConfig } from '@pulse-ide/shared';

const DEFAULT_CONFIG: AgentConfig = {
  model: 'openrouter/owl-alpha',
  apiKey: 'test-key',
  baseURL: 'https://openrouter.ai/api/v1',
  maxIterations: 10,
  temperature: 0.1,
};

describe('Multi-Call Agent', () => {
  describe('runMultiCallAgent', () => {
    it('should execute a rename variable query', () => {
      const result = runMultiCallAgent('Rename variable `user` to `customer` in auth.ts', DEFAULT_CONFIG);

      expect(result.status).toBe('done');
      expect(result.completedSteps.length).toBeGreaterThan(0);
      expect(result.filesRead.length).toBeGreaterThan(0);
      expect(result.fileChanges.length).toBeGreaterThan(0);
      expect(result.fileChanges[0].filePath).toBe('auth.ts');
    });

    it('should read files during execution', () => {
      const result = runMultiCallAgent('Rename variable `user` to `customer` in auth.ts', DEFAULT_CONFIG);

      expect(result.filesRead).toContain('auth.ts');
    });

    it('should track file changes with correct structure', () => {
      const result = runMultiCallAgent('Rename variable `user` to `customer` in auth.ts', DEFAULT_CONFIG);

      expect(result.fileChanges.length).toBeGreaterThan(0);
      const change = result.fileChanges[0];
      expect(change).toHaveProperty('filePath');
      expect(change).toHaveProperty('oldContent');
      expect(change).toHaveProperty('newContent');
      expect(change).toHaveProperty('hunks');
      expect(change.hunks.length).toBeGreaterThan(0);
    });

    it('should complete within max iterations', () => {
      const result = runMultiCallAgent('Rename variable `user` to `customer` in auth.ts', {
        ...DEFAULT_CONFIG,
        maxIterations: 5,
      });

      expect(result.iteration).toBeLessThanOrEqual(5);
      expect(result.status).toBe('done');
    });

    it('should handle search queries', () => {
      const result = runMultiCallAgent('Search codebase for authentication logic', DEFAULT_CONFIG);

      expect(result.status).toBe('done');
      expect(result.completedSteps.length).toBeGreaterThan(0);
    });

    it('should return messages with plan and summary', () => {
      const result = runMultiCallAgent('Rename variable `user` to `customer` in auth.ts', DEFAULT_CONFIG);

      expect(result.messages.length).toBeGreaterThanOrEqual(2); // plan + summary
      expect(result.messages[0].role).toBe('assistant');
      expect(result.messages[0].content).toContain('Plan:');
    });
  });

  describe('createMultiCallAgent', () => {
    it('should create an agent with config', () => {
      const agent = createMultiCallAgent(DEFAULT_CONFIG);

      expect(agent).toHaveProperty('run');
      expect(agent).toHaveProperty('config');
      expect(agent.config.model).toBe('openrouter/owl-alpha');
    });

    it('should run a query via the agent', () => {
      const agent = createMultiCallAgent(DEFAULT_CONFIG);
      const result = agent.run('Rename variable `user` to `customer` in auth.ts');

      expect(result.status).toBe('done');
      expect(result.completedSteps.length).toBeGreaterThan(0);
    });
  });

  describe('validateOutput', () => {
    it('should pass validation for normal output', () => {
      const result = validateOutput('read_file', 'file content here', { path: 'test.ts' });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail validation for error output', () => {
      const result = validateOutput('read_file', 'Error: file not found', { path: 'test.ts' });

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should warn on empty write', () => {
      const result = validateOutput('write_file', 'Written 0 bytes', { path: 'test.ts', content: '' });

      expect(result.valid).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('should fail validation for edit with text not found', () => {
      const result = validateOutput('edit_file', 'Error: Text not found in file', {
        path: 'test.ts',
        old_text: 'nonexistent',
        new_text: 'replacement',
      });

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });
});
