// packages/backend/src/context/cache/semantic-cache.ts
// Semantic cache for LLM responses (simple in-memory, Redis/SQLite upgrade path)

interface CacheEntry {
  query: string;
  response: string;
  embedding: number[];
  timestamp: number;
  hits: number;
}

export class SemanticCache {
  private entries: Map<string, CacheEntry> = new Map();
  private maxSize: number;

  constructor(maxSize: number = 1000) {
    this.maxSize = maxSize;
  }

  get(query: string): string | null {
    const key = this.normalize(query);
    const entry = this.entries.get(key);
    if (entry) {
      entry.hits++;
      return entry.response;
    }
    // Simple fuzzy match — check if any cached query is a substring
    for (const [k, v] of this.entries) {
      if (key.includes(k) || k.includes(key)) {
        v.hits++;
        return v.response;
      }
    }
    return null;
  }

  set(query: string, response: string): void {
    if (this.entries.size >= this.maxSize) {
      // Evict least used
      let minKey = '';
      let minHits = Infinity;
      for (const [k, v] of this.entries) {
        if (v.hits < minHits) { minHits = v.hits; minKey = k; }
      }
      if (minKey) this.entries.delete(minKey);
    }
    this.entries.set(this.normalize(query), {
      query,
      response,
      embedding: [],
      timestamp: Date.now(),
      hits: 0,
    });
  }

  clear(): void {
    this.entries.clear();
  }

  getStats(): { size: number; maxSize: number } {
    return { size: this.entries.size, maxSize: this.maxSize };
  }

  private normalize(query: string): string {
    return query.toLowerCase().trim().replace(/\s+/g, ' ');
  }
}
