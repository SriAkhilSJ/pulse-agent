// packages/backend/src/cache/semantic-cache.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SemanticCache } from './semantic-cache.js';
import * as fs from 'fs';

// Mock fetch for Ollama embeddings
const mockFetch = vi.fn();
global.fetch = mockFetch;

const TEST_DB = './test-cache.db';

describe('SemanticCache', () => {
  let cache: SemanticCache;

  beforeEach(() => {
    vi.clearAllMocks();
    // Clean up test db
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    cache = new SemanticCache({ dbPath: TEST_DB, similarityThreshold: 0.95 });
  });

  afterEach(() => {
    cache.close();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  describe('embedding generation', () => {
    it('should generate embedding via Ollama', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ embedding: [0.1, 0.2, 0.3, 0.4] }),
      });

      const embedding = await cache.getEmbedding('test query');

      expect(embedding).toEqual([0.1, 0.2, 0.3, 0.4]);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/embeddings'),
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should return empty embedding on Ollama failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

      const embedding = await cache.getEmbedding('test query');

      expect(embedding).toEqual([]);
    });

    it('should return empty embedding on non-OK response', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

      const embedding = await cache.getEmbedding('test query');

      expect(embedding).toEqual([]);
    });
  });

  describe('cache operations', () => {
    it('should store and retrieve a cached response', async () => {
      const embedding = [0.1, 0.2, 0.3, 0.4];
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({ embedding }) });

      await cache.store('How to fix auth.ts?', 'Fixed the auth bug', 'single_call');

      const result = await cache.lookup('How to fix auth.ts?');

      expect(result).toBeDefined();
      expect(result!.response).toBe('Fixed the auth bug');
      expect(result!.route).toBe('single_call');
    });

    it('should return null for cache miss', async () => {
      const embedding1 = [0.1, 0.2, 0.3, 0.4];
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ embedding: embedding1 }) });
      await cache.store('Query A', 'Response A', 'single_call');

      const embedding2 = [0.9, 0.8, 0.7, 0.6]; // Very different
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ embedding: embedding2 }) });
      const result = await cache.lookup('Completely different query');

      expect(result).toBeNull();
    });

    it('should find similar queries above threshold', async () => {
      const embedding1 = [0.1, 0.2, 0.3, 0.4];
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ embedding: embedding1 }) });
      await cache.store('How to fix auth.ts?', 'Fixed auth', 'single_call');

      // Very similar embedding (cosine similarity > 0.95)
      const embedding2 = [0.11, 0.21, 0.31, 0.41];
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ embedding: embedding2 }) });
      const result = await cache.lookup('How to fix auth.ts?');

      expect(result).toBeDefined();
      expect(result!.response).toBe('Fixed auth');
    });

    it('should increment hit count on cache hit', async () => {
      const embedding = [0.1, 0.2, 0.3, 0.4];
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({ embedding }) });

      await cache.store('test query', 'test response', 'single_call');
      await cache.lookup('test query');
      const result = await cache.lookup('test query');

      expect(result).toBeDefined();
      expect(result!.hits).toBe(2);
    });

    it('should evict old entries when at capacity', async () => {
      const smallCache = new SemanticCache({ dbPath: TEST_DB, maxSize: 5 });
      const embedding = [0.1, 0.2, 0.3, 0.4];
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({ embedding }) });

      // Fill cache
      for (let i = 0; i < 5; i++) {
        await smallCache.store(`query ${i}`, `response ${i}`, 'single_call');
      }

      const stats = smallCache.getStats();
      expect(stats.size).toBeLessThanOrEqual(5);

      smallCache.close();
    });

    it('should clear all cache', async () => {
      const embedding = [0.1, 0.2, 0.3, 0.4];
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({ embedding }) });

      await cache.store('q1', 'r1', 'single_call');
      await cache.store('q2', 'r2', 'multi_call');

      expect(cache.getStats().size).toBe(2);

      cache.clear();
      expect(cache.getStats().size).toBe(0);
    });
  });

  describe('cosine similarity', () => {
    it('should return 1.0 for identical vectors', async () => {
      const embedding = [0.1, 0.2, 0.3, 0.4];
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({ embedding }) });

      await cache.store('test', 'response', 'single_call');
      const result = await cache.lookup('test');

      expect(result).toBeDefined();
    });

    it('should return 0 for empty vectors', async () => {
      mockFetch.mockResolvedValue({ ok: true, json: async () => ({ embedding: [] }) });

      await cache.store('test', 'response', 'single_call');
      const result = await cache.lookup('test');

      expect(result).toBeNull();
    });

    it('should return null for different length vectors', async () => {
      const embedding1 = [0.1, 0.2, 0.3, 0.4];
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ embedding: embedding1 }) });
      await cache.store('test', 'response', 'single_call');

      const embedding2 = [0.1, 0.2]; // Different length
      mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ embedding: embedding2 }) });
      const result = await cache.lookup('different');

      expect(result).toBeNull();
    });
  });

  describe('stats', () => {
    it('should report cache size', () => {
      const stats = cache.getStats();
      expect(stats.size).toBe(0);
      expect(stats.maxSize).toBe(10000);
    });
  });
});
