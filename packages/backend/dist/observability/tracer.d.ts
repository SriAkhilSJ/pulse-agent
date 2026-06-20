interface TraceEntry {
    id: string;
    type: 'llm_call' | 'tool_call' | 'error' | 'info';
    name: string;
    duration?: number;
    metadata?: Record<string, unknown>;
    timestamp: number;
}
export declare class Tracer {
    private entries;
    private maxEntries;
    trace(entry: Omit<TraceEntry, 'id' | 'timestamp'>): void;
    getTraces(type?: string): TraceEntry[];
    clear(): void;
}
export declare const tracer: Tracer;
export {};
//# sourceMappingURL=tracer.d.ts.map