"use strict";
// packages/backend/src/observability/tracer.ts
// Tracer — observability for agent runs
// Supports local logging + optional LangSmith integration via raw HTTP
Object.defineProperty(exports, "__esModule", { value: true });
exports.tracer = exports.Tracer = void 0;
exports.calculateCost = calculateCost;
// ---------------------------------------------------------------------------
// Token estimation (rough: 1 token ≈ 4 chars)
// ---------------------------------------------------------------------------
function estimateTokens(text) {
    return Math.ceil(text.length / 4);
}
// ---------------------------------------------------------------------------
// Cost calculation (per model)
// ---------------------------------------------------------------------------
function calculateCost(model, tokensIn, tokensOut) {
    const pricing = {
        'gpt-4o': { input: 2.5 / 1_000_000, output: 10 / 1_000_000 },
        'gpt-4o-mini': { input: 0.15 / 1_000_000, output: 0.6 / 1_000_000 },
        'deepseek-r1:14b': { input: 0, output: 0 }, // local, free
        'deepseek-r1:7b': { input: 0, output: 0 },
        'llama3.2:3b': { input: 0, output: 0 },
        'openrouter/owl-alpha': { input: 0, output: 0 },
    };
    const p = pricing[model] || { input: 0, output: 0 };
    return tokensIn * p.input + tokensOut * p.output;
}
// ---------------------------------------------------------------------------
// Tracer singleton
// ---------------------------------------------------------------------------
class Tracer {
    currentTrace = null;
    langSmithApiKey;
    langSmithEndpoint;
    constructor() {
        this.langSmithApiKey = process.env['LANGSMITH_API_KEY'] || '';
        this.langSmithEndpoint = process.env['LANGSMITH_ENDPOINT'] || 'https://api.smith.langchain.com';
    }
    /** Start a new trace */
    startTrace(query, route, model, sessionId) {
        this.currentTrace = {
            id: `trace-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
            sessionId,
            query,
            route,
            model,
            tokensInput: estimateTokens(query),
            tokensOutput: 0,
            cost: 0,
            durationMs: 0,
            success: false,
            steps: [],
            timestamp: Date.now(),
        };
        return this.currentTrace;
    }
    /** Log a step */
    logStep(step) {
        if (!this.currentTrace)
            return;
        this.currentTrace.steps.push(step);
        if (step.type === 'llm') {
            this.currentTrace.tokensInput += estimateTokens(String(step.input || ''));
            this.currentTrace.tokensOutput += estimateTokens(String(step.output || ''));
            this.currentTrace.cost = calculateCost(this.currentTrace.model, this.currentTrace.tokensInput, this.currentTrace.tokensOutput);
        }
    }
    /** End the trace */
    async endTrace(success, error) {
        if (!this.currentTrace)
            return null;
        this.currentTrace.success = success;
        this.currentTrace.durationMs = Date.now() - this.currentTrace.timestamp;
        this.currentTrace.error = error;
        // Send to LangSmith if API key is set
        if (this.langSmithApiKey) {
            await this.sendToLangSmith(this.currentTrace);
        }
        // Always log locally
        console.log('[TRACE]', this.currentTrace.id, this.currentTrace.route, `${this.currentTrace.durationMs}ms`, this.currentTrace.success ? 'OK' : 'FAIL');
        const trace = this.currentTrace;
        this.currentTrace = null;
        return trace;
    }
    /** Get current trace */
    getCurrentTrace() {
        return this.currentTrace;
    }
    /** Send trace to LangSmith via raw HTTP */
    async sendToLangSmith(trace) {
        try {
            await fetch(`${this.langSmithEndpoint}/runs`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.langSmithApiKey}`,
                },
                body: JSON.stringify({
                    id: trace.id,
                    name: `pulse-${trace.route}`,
                    run_type: 'chain',
                    inputs: { query: trace.query },
                    outputs: { success: trace.success, error: trace.error },
                    extra: {
                        model: trace.model,
                        tokens_input: trace.tokensInput,
                        tokens_output: trace.tokensOutput,
                        cost: trace.cost,
                        duration_ms: trace.durationMs,
                        steps: trace.steps,
                    },
                    session_id: trace.sessionId,
                    start_time: trace.timestamp,
                    end_time: trace.timestamp + trace.durationMs,
                }),
            });
        }
        catch (err) {
            console.error('[TRACE] LangSmith send failed:', err instanceof Error ? err.message : String(err));
        }
    }
}
exports.Tracer = Tracer;
exports.tracer = new Tracer();
//# sourceMappingURL=tracer.js.map