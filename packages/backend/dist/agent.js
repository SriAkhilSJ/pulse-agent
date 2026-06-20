"use strict";
// packages/backend/src/agent.ts
// PulseCode AI — Core Agent
// Architecture: 1 API call = 1 loop iteration (Claude Code / Cursor pattern)
Object.defineProperty(exports, "__esModule", { value: true });
exports.Agent = void 0;
const config_js_1 = require("./config.js");
class Agent {
    apiKey;
    baseURL;
    model;
    registry;
    shellInfo;
    abortSignal;
    onToolStepCallback;
    contextBuilder;
    memorySystem;
    thinkingConfig = null;
    reasoningEffort = null;
    _activeAbortController;
    _askUserResolve;
    _permissionResolve;
    constructor(apiKey, baseURL, registry, options) {
        this.apiKey = apiKey;
        this.baseURL = baseURL;
        this.model = options?.model || 'openrouter/owl-alpha';
        this.registry = registry;
        this.shellInfo = options?.shellInfo;
    }
    setApiKey(key) { this.apiKey = key; }
    setBaseURL(url) { this.baseURL = url; }
    setModel(model) { this.model = model; }
    setAbortSignal(signal) { this.abortSignal = signal; }
    setOnToolStepCallback(cb) { this.onToolStepCallback = cb; }
    setContextBuilder(fn) { this.contextBuilder = fn; }
    setMemorySystem(ms) { this.memorySystem = ms; }
    setThinking(thinking, reasoningEffort) {
        this.thinkingConfig = thinking;
        this.reasoningEffort = reasoningEffort || null;
    }
    async chat(userMessage, conversationHistory, onToolStep, onThinking, onTextDelta, onThinkingDelta) {
        const messages = conversationHistory ? [...conversationHistory] : [];
        // Build system prompt
        let systemPrompt = this.buildSystemPrompt();
        if (this.contextBuilder) {
            const ctx = this.contextBuilder();
            if (ctx)
                systemPrompt += '\n' + ctx;
        }
        messages.unshift({ role: 'system', content: systemPrompt });
        messages.push({ role: 'user', content: userMessage });
        let iteration = 0;
        const maxIterations = config_js_1.config.maxIterations;
        while (iteration < maxIterations) {
            iteration++;
            this._activeAbortController = new AbortController();
            // Check abort
            if (this.abortSignal?.aborted || this._activeAbortController?.signal.aborted) {
                throw new Error('Request aborted by user');
            }
            const response = await this.callLLM(messages, onThinking, onTextDelta, onThinkingDelta);
            // If no tool calls, we're done
            if (!response.tool_calls || response.tool_calls.length === 0) {
                messages.push({ role: 'assistant', content: response.content });
                return { response: response.content || '', messages: messages.slice(1) }; // strip system
            }
            // Add assistant message with tool calls
            messages.push({
                role: 'assistant',
                content: response.content,
                tool_calls: response.tool_calls,
            });
            // Execute all tool calls in parallel
            const toolResults = await Promise.all(response.tool_calls.map(async (tc) => {
                const step = {
                    id: tc.id,
                    toolName: tc.function.name,
                    toolArgs: JSON.parse(tc.function.arguments || '{}'),
                    status: 'running',
                };
                if (onToolStep)
                    onToolStep(step);
                this.onToolStepCallback?.(step);
                const start = Date.now();
                try {
                    const result = await this.registry.execute(tc.function.name, JSON.parse(tc.function.arguments || '{}'));
                    step.status = 'done';
                    step.result = result;
                    step.duration = Date.now() - start;
                }
                catch (err) {
                    step.status = 'error';
                    step.result = err.message;
                    step.duration = Date.now() - start;
                }
                if (onToolStep)
                    onToolStep(step);
                this.onToolStepCallback?.(step);
                return {
                    tool_call_id: tc.id,
                    role: 'tool',
                    content: step.result || '',
                };
            }));
            messages.push(...toolResults);
        }
        throw new Error(`Max iterations (${maxIterations}) exceeded`);
    }
    buildSystemPrompt() {
        const toolNames = this.registry.getToolNames();
        let prompt = `You are PulseCode AI, an autonomous coding agent. You have access to tools: ${toolNames.join(', ')}.

CORE RULES:
1. Use tools to accomplish tasks. Think step by step.
2. Read files before editing them.
3. After writing code, verify it compiles/passes tests.
4. Be concise. Don't explain what you're about to do — just do it.
5. If you need user input, use the ask_user tool.
6. When done, provide a brief summary of what you accomplished.

WORKING DIRECTORY: ${process.cwd()}
`;
        if (this.memorySystem) {
            const memBlock = this.memorySystem.getMemoryBlock?.();
            if (memBlock)
                prompt += memBlock;
            const profileBlock = this.memorySystem.getProfileBlock?.();
            if (profileBlock)
                prompt += profileBlock;
        }
        return prompt;
    }
    async callLLM(messages, onThinking, onTextDelta, onThinkingDelta) {
        const body = {
            model: this.model,
            messages: messages.map(m => ({
                role: m.role,
                content: m.content,
                ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
                ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
            })),
            tools: this.registry.getToolsSchema(),
            max_tokens: config_js_1.config.maxTokens,
            stream: config_js_1.config.streaming,
        };
        if (this.thinkingConfig) {
            body.thinking = this.thinkingConfig;
        }
        if (this.reasoningEffort) {
            body.reasoning_effort = this.reasoningEffort;
        }
        const controller = this._activeAbortController;
        const timeout = setTimeout(() => controller.abort(), config_js_1.config.llmTimeoutMs);
        try {
            const response = await fetch(`${this.baseURL}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`,
                },
                body: JSON.stringify(body),
                signal: controller.signal,
            });
            clearTimeout(timeout);
            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`LLM API error ${response.status}: ${errText}`);
            }
            if (config_js_1.config.streaming) {
                return this.handleStreaming(response, onThinking, onTextDelta, onThinkingDelta);
            }
            const data = await response.json();
            const choice = data.choices?.[0]?.message;
            return {
                content: choice?.content || null,
                tool_calls: choice?.tool_calls,
            };
        }
        catch (err) {
            clearTimeout(timeout);
            throw err;
        }
    }
    async handleStreaming(response, onThinking, onTextDelta, onThinkingDelta) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let fullContent = '';
        let thinkingContent = '';
        const toolCallsMap = new Map();
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || !trimmed.startsWith('data: '))
                    continue;
                const data = trimmed.substring(6);
                if (data === '[DONE]')
                    continue;
                try {
                    const parsed = JSON.parse(data);
                    const delta = parsed.choices?.[0]?.delta;
                    if (!delta)
                        continue;
                    if (delta.content) {
                        fullContent += delta.content;
                        onTextDelta?.(delta.content);
                    }
                    if (delta.reasoning_content || delta.thinking) {
                        const t = delta.reasoning_content || delta.thinking;
                        thinkingContent += t;
                        onThinkingDelta?.(t);
                    }
                    if (delta.tool_calls) {
                        for (const tc of delta.tool_calls) {
                            const existing = toolCallsMap.get(tc.index) || { id: '', type: 'function', function: { name: '', arguments: '' } };
                            if (tc.id)
                                existing.id = tc.id;
                            if (tc.function?.name)
                                existing.function.name += tc.function.name;
                            if (tc.function?.arguments)
                                existing.function.arguments += tc.function.arguments;
                            toolCallsMap.set(tc.index, existing);
                        }
                    }
                }
                catch { /* skip malformed */ }
            }
        }
        if (thinkingContent)
            onThinking?.(thinkingContent);
        return {
            content: fullContent || null,
            tool_calls: toolCallsMap.size > 0 ? Array.from(toolCallsMap.values()) : undefined,
        };
    }
}
exports.Agent = Agent;
//# sourceMappingURL=agent.js.map