"use strict";
// packages/backend/src/observability/tracer.ts
// LangSmith-style tracing (simplified, no external dependency)
Object.defineProperty(exports, "__esModule", { value: true });
exports.tracer = exports.Tracer = void 0;
class Tracer {
    entries = [];
    maxEntries = 1000;
    trace(entry) {
        const full = {
            ...entry,
            id: Math.random().toString(36).substring(2),
            timestamp: Date.now(),
        };
        this.entries.push(full);
        if (this.entries.length > this.maxEntries) {
            this.entries = this.entries.slice(-this.maxEntries);
        }
        console.log('[TRACE]', full.type, full.name, entry.duration ? `${entry.duration}ms` : '');
    }
    getTraces(type) {
        if (type)
            return this.entries.filter(e => e.type === type);
        return [...this.entries];
    }
    clear() {
        this.entries = [];
    }
}
exports.Tracer = Tracer;
exports.tracer = new Tracer();
//# sourceMappingURL=tracer.js.map