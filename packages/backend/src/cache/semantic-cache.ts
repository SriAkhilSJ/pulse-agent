// packages/backend/src/cache/semantic-cache.ts
// Semantic Cache — SQLite + Ollama embeddings
// Stores query embeddings, does cosine similarity lookup

import Database from 'better-sqlite3';
import type { CachedResponse, CacheConfig } from '@pulse-ide/shared';
import { getDefaultCacheConfig } from '@pulse-ide/shared';

export class SemanticCache {
  private db: Database.Database;
  private config: CacheConfig;

  constructor(config?: Partial<CacheConfig>) {
    this.config = { ...getDefaultCacheConfig(), ...config };
    this.db = new Database(this.config.dbPath);
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        query TEXT NOT NULL,
        embedding TEXT NOT NULL,
        response TEXT NOT NULL,
        route TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        hits INTEGER DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_cache_timestamp ON cache(timestamp);
    `);
  }

  /** Generate embedding via Ollama */
  async getEmbedding(text: string): Promise<number[]> {
    try {
      const response = await fetch(`${this.config.ollamaUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.config.ollamaEmbeddingModel,
          prompt: text,
        }),
      });

      if (!response.ok) throw new Error(`Ollama error ${response.status}`);

      const data = await response.json() as any;
      return data.embedding || [];
    } catch {
      // Fallback: return empty embedding (cache won't match)
      return [];
    }
  }

  /** Cosine similarity between two vectors */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length === 0 || b.length === 0) return 0;
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dotProduct / denom;
  }

  /** Look up a similar cached query */
  async lookup(query: string): Promise<CachedResponse | null> {
    const embedding = await this.getEmbedding(query);
    if (embedding.length === 0) return null;

    const rows = this.db.prepare('SELECT * FROM cache ORDER BY timestamp DESC LIMIT 100').all() as any[];

    let bestMatch: CachedResponse | null = null;
    let bestScore = 0;

    for (const row of rows) {
      const cachedEmbedding = JSON.parse(row.embedding) as number[];
      const similarity = this.cosineSimilarity(embedding, cachedEmbedding);

      if (similarity > bestScore) {
        bestScore = similarity;
        bestMatch = {
          query: row.query,
          response: row.response,
          embedding: cachedEmbedding,
          route: row.route,
          timestamp: row.timestamp,
          hits: row.hits,
        };
      }
    }

    if (bestMatch && bestScore >= this.config.similarityThreshold) {
      // Increment hit count
      this.db.prepare('UPDATE cache SET hits = hits + 1 WHERE query = ?').run(bestMatch.query);
      bestMatch.hits++;
      return bestMatch;
    }

    return null;
  }

  /** Store a query + response + embedding */
  async store(query: string, response: string, route: string): Promise<void> {
    const embedding = await this.getEmbedding(query);
    if (embedding.length === 0) return;

    // Evict oldest if at capacity
    const count = (this.db.prepare('SELECT COUNT(*) as c FROM cache').get() as any).c;
    if (count >= this.config.maxSize) {
      this.db.prepare('DELETE FROM cache WHERE id IN (SELECT id FROM cache ORDER BY timestamp ASC LIMIT ?)').run(Math.floor(this.config.maxSize * 0.1));
    }

    this.db.prepare(
      'INSERT INTO cache (query, embedding, response, route, timestamp) VALUES (?, ?, ?, ?, ?)'
    ).run(query, JSON.stringify(embedding), response, route, Date.now());
  }

  /** Clear all cache */
  clear(): void {
    this.db.prepare('DELETE FROM cache').run();
  }

  /** Get cache stats */
  getStats(): { size: number; maxSize: number } {
    const count = (this.db.prepare('SELECT COUNT(*) as c FROM cache').get() as any).c;
    return { size: count, maxSize: this.config.maxSize };
  }

  /** Close the database */
  close(): void {
    this.db.close();
  }
}
