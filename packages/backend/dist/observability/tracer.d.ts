import type { Trace, StepTrace } from '@pulse-ide/shared';
export declare function calculateCost(model: string, tokensIn: number, tokensOut: number): number;
export declare class Tracer {
    private currentTrace;
    private langSmithApiKey;
    private langSmithEndpoint;
    constructor();
    /** Start a new trace */
    startTrace(query: string, route: 'autocomplete' | 'single_call' | 'multi_call', model: string, sessionId: string): Trace;
    /** Log a step */
    logStep(step: StepTrace): void;
    /** End the trace */
    endTrace(success: boolean, error?: string): Promise<Trace | null>;
    /** Get current trace */
    getCurrentTrace(): Trace | null;
    /** Send trace to LangSmith via raw HTTP */
    private sendToLangSmith;
}
export declare const tracer: Tracer;
//# sourceMappingURL=tracer.d.ts.map