"use strict";
// packages/backend/src/context/cache/semantic-cache.ts
// Semantic cache for LLM responses (simple in-memory, Redis/SQLite upgrade path)
Object.defineProperty(exports, "__esModule", { value: true });
exports.SemanticCache = void 0;
class SemanticCache {
    entries = new Map();
    maxSize;
    constructor(maxSize = 1000) {
        this.maxSize = maxSize;
    }
    get(query) {
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
    set(query, response) {
        if (this.entries.size >= this.maxSize) {
            // Evict least used
            let minKey = '';
            let minHits = Infinity;
            for (const [k, v] of this.entries) {
                if (v.hits < minHits) {
                    minHits = v.hits;
                    minKey = k;
                }
            }
            if (minKey)
                this.entries.delete(minKey);
        }
        this.entries.set(this.normalize(query), {
            query,
            response,
            embedding: [],
            timestamp: Date.now(),
            hits: 0,
        });
    }
    clear() {
        this.entries.clear();
    }
    getStats() {
        return { size: this.entries.size, maxSize: this.maxSize };
    }
    normalize(query) {
        return query.toLowerCase().trim().replace(/\s+/g, ' ');
    }
}
exports.SemanticCache = SemanticCache;
//# sourceMappingURL=semantic-cache.js.map