// packages/backend/src/observability/tracer.ts
// LangSmith-style tracing (simplified, no external dependency)

import type { ToolStep } from '@pulse-ide/shared';

interface TraceEntry {
  id: string;
  type: 'llm_call' | 'tool_call' | 'error' | 'info';
  name: string;
  duration?: number;
  metadata?: Record<string, unknown>;
  timestamp: number;
}

export class Tracer {
  private entries: TraceEntry[] = [];
  private maxEntries = 1000;

  trace(entry: Omit<TraceEntry, 'id' | 'timestamp'>): void {
    const full: TraceEntry = {
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

  getTraces(type?: string): TraceEntry[] {
    if (type) return this.entries.filter(e => e.type === type);
    return [...this.entries];
  }

  clear(): void {
    this.entries = [];
  }
}

export const tracer = new Tracer();
