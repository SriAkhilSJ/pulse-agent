// src/agent.ts
// PulseCode AI -- Core Agent
// Architecture: 1 API call = 1 loop iteration (Claude Code / Cursor pattern)
//
// Loop:
//   1. Send messages + tools to LLM -> get response
//   2. If no tool_calls -> return final answer
//   3. Execute ALL tool_calls in parallel (Promise.all)
//   4. Append results -> go to step 1
//   5. Repeat until done (max iterations from config)
//
// Cost: 1 API call per iteration, typically 2-3 per user message.

import { ToolRegistry } from './tool-registry';
import { MemorySystem } from './memory-system';

// --- Message types --------------------------------------------------
export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

// --- Tool step tracking ---------------------------------------------
export interface ToolStep {
  id: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  status: 'running' | 'done' | 'error';
  result?: string;
  duration?: number;
  agentId?: string;
  agentName?: string;
  query?: string;
  fileCount?: number;
  url?: string;
  selector?: string;
  screenshot?: string;
  command?: string;
  output?: string;
  matches?: Array<{ file: string; line: string; text: string }>;
}

export type ToolStepCallback = (step: ToolStep) => void;

// --- Audit + cost ---------------------------------------------------
export interface AuditEntry {
  timestamp: number;
  filePath: string;
  action: 'modify' | 'rollback' | 'delete';
  summary: string;
}

export interface SessionCost {
  apiCalls: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
}

// --- Ask user --------------------------------------------------------
export class AskUserError extends Error {
  public readonly question: string;
  public readonly motive: string;
  public readonly options: string[];
  constructor(question: string, motive: string, options: string[] = []) {
    super('ASK_USER: ' + question);
    this.name = 'AskUserError';
    this.question = question;
    this.motive = motive;
    this.options = options;
  }
}

export async function askUserTool(args: Record<string, unknown>): Promise<string> {
  let question = args.question as string;
  let motive = (args.motive as string) || 'I need clarification to proceed.';
  let optionsStr = args.options as string;

  if (!question && Array.isArray(args)) {
    const first = (args as any[])[0];
    if (first && typeof first === 'object') {
      question = first.question as string;
      motive = (first.motive as string) || motive;
      optionsStr = first.options as string;
    }
  }

  if (!question) {
    throw new Error('ask_user requires "question" parameter');
  }

  const options = optionsStr ? optionsStr.split('|').map((s: string) => s.trim()) : [];
  throw new AskUserError(question, motive, options);
}

// --- Config ---------------------------------------------------------
export interface ShellInfo {
  name: string;
  path: string;
  args: string[];
  platform: string;
}

export type AgentMode = 'chat' | 'code' | 'plan';

export interface AgentConfig {
  model?: string;
  maxIterations?: number;
  systemPrompt?: string;
  shellInfo?: ShellInfo;
  mode?: AgentMode;
}

// -- Context builder callback -------------------------------------------
// Extension provides this so the agent can inject fresh context each turn
// (memory, rules, flow state, current file, workspace info, etc.)
export type ContextBuilder = () => string;

import { config } from './config';

const DEFAULT_MAX_ITERATIONS = config.maxIterations;
const DEFAULT_TIMEOUT_MS = config.llmTimeoutMs;
const MAX_TOOL_RESULT_CHARS = config.maxToolResultChars;

// Per-session call tracking to enforce MAX_CALLS_PER_SESSION
// Keyed by sessionId — each new conversation gets a fresh counter automatically
const sessionCallCounts = new Map<string, number>();

// Periodically clean up stale session counters to prevent memory leaks
const _sessionCleanupInterval = setInterval(() => {
  if (sessionCallCounts.size > config.sessionMaxStale) {
    const keys = Array.from(sessionCallCounts.keys());
    const toRemove = keys.slice(0, keys.length - config.sessionMaxStale);
    for (const key of toRemove) sessionCallCounts.delete(key);
  }
}, config.sessionCleanupIntervalMs);
// Don't let the interval prevent Node from exiting
(_sessionCleanupInterval as any).unref && (_sessionCleanupInterval as any).unref();

export function cleanupStaleSessions(currentSessionId: string): void {
  if (sessionCallCounts.size <= config.sessionMaxStale) return;
  // Sort keys: keep current session + most recent by insertion order
  const keys = Array.from(sessionCallCounts.keys());
  // Always keep current session; remove oldest first
  const toRemove = keys.filter(k => k !== currentSessionId);
  // Only remove enough to get back under the limit
  const targetRemove = sessionCallCounts.size - config.sessionMaxStale;
  let removed = 0;
  for (const key of toRemove) {
    if (removed >= targetRemove) break;
    sessionCallCounts.delete(key);
    removed++;
  }
  if (removed > 0) console.log('[Agent] Cleaned up ' + removed + ' stale session call counters');
}

// ===================================================================
// AGENT CLASS
// ===================================================================
export class Agent {
  private apiKey: string;
  private baseURL: string;
  private registry: ToolRegistry;
  private auditLog: AuditEntry[] = [];
  private _customSystemPrompt: string | null = null;
  private _model: string = '';
  private _maxIterations: number = DEFAULT_MAX_ITERATIONS;
  private _timeoutMs: number = DEFAULT_TIMEOUT_MS;
  private _abortSignal: AbortSignal | null = null;
  // The currently active AbortController for the in-flight LLM call.
  // Stop button aborts this directly instead of creating a new signal.
  private _activeAbortController: AbortController | null = null;
  private _cost: SessionCost = { apiCalls: 0, inputTokens: 0, outputTokens: 0, estimatedCost: 0 };
  private _memorySystem: MemorySystem | null = null;
  private _sessionId: string = 'default';
  private _maxCallsPerSession: number = config.maxCallsPerSession;
  private _shellInfo: ShellInfo | null = null;
  private _contextBuilder: ContextBuilder | null = null;
  private _mode: AgentMode = 'code';
  private _onToolStepCallback: ToolStepCallback | null = null;
  // Thinking/reasoning config — when set, sent to LLM API to enable extended thinking
  private _thinkingConfig: Record<string, unknown> | null = null;
  private _thinkingEffort: string = 'medium';
  public onSpawnAgent: ((task: string, instructions: string) => Promise<string>) | null = null;
  // Cached system prompt -- rebuilt only when context changes, not every iteration
  private _cachedSystemPrompt: string = "";
  private _systemPromptDirty: boolean = true;

  setMemorySystem(mem: MemorySystem | null) { this._memorySystem = mem; }
  getMemorySystem(): MemorySystem | null { return this._memorySystem; }
  setSessionId(id: string) { this._sessionId = id; }
  getSessionId(): string { return this._sessionId; }
  setShellInfo(info: ShellInfo | null) { this._shellInfo = info; }
  setContextBuilder(cb: ContextBuilder | null) { this._contextBuilder = cb; this._systemPromptDirty = true; }
  setMode(mode: AgentMode) { this._mode = mode; this._systemPromptDirty = true; }
  getMode(): AgentMode { return this._mode; }
  setOnToolStepCallback(cb: ToolStepCallback | null) { this._onToolStepCallback = cb; }
  getOnToolStepCallback(): ToolStepCallback | null { return this._onToolStepCallback; }
  /** Enable extended thinking/reasoning. Pass Anthropic-style thinking config. */
  setThinking(config: Record<string, unknown> | null, effort: string = 'medium') { this._thinkingConfig = config; this._thinkingEffort = effort; }

  constructor(apiKey: string, baseURL: string, registry: ToolRegistry, cfg?: AgentConfig) {
    this.apiKey = apiKey;
    console.log('[Agent] API key loaded: ' + (apiKey ? '****' : 'EMPTY'));
    this.baseURL = baseURL;
    this.registry = registry;
    if (cfg?.model) this._model = cfg.model;
    if (cfg?.maxIterations) this._maxIterations = cfg.maxIterations;
    if (cfg?.systemPrompt) this._customSystemPrompt = cfg.systemPrompt;
    if (cfg?.shellInfo) this._shellInfo = cfg.shellInfo;
    if (cfg?.mode) this._mode = cfg.mode;
  }

  setModel(model: string): void { this._model = model; }
  setBaseURL(url: string): void { this.baseURL = url; }
  setApiKey(key: string): void { this.apiKey = key; }
  setSystemPrompt(prompt: string): void { this._customSystemPrompt = prompt; this._systemPromptDirty = true; }
  setAbortSignal(signal: AbortSignal | null): void { this._abortSignal = signal; }
  getCost(): SessionCost { return { ...this._cost }; }
  getAuditLog(): AuditEntry[] { return [...this.auditLog]; }

  addAuditEntry(entry: AuditEntry): void {
    this.auditLog.push(entry);
    if (this.auditLog.length > 50) this.auditLog = this.auditLog.slice(-50);
  }

  // -- Public tool execution (for external callers) ----------------------
  async runTool(toolName: string, args: Record<string, unknown>): Promise<string> {
    return this.registry.execute(toolName, args);
  }

  // ===================================================================
  // MAIN CHAT -> Stateful conversation with tool-calling loop
  // ===================================================================
  async chat(
    userMessage: string,
    conversationHistory?: Message[],
    onToolStep?: ToolStepCallback,
    onThinking?: (text: string) => void,
    onTextDelta?: (text: string) => void,
    onThinkingDelta?: (text: string) => void,
  ): Promise<{ response: string; history: Message[]; requiresReload: boolean; toolSteps: ToolStep[]; cost: SessionCost; thinkingText: string }> {
    const startTime = Date.now();
    const tools = this.registry.getToolsSchema();
    let requiresReload = false;
    const allToolSteps: ToolStep[] = [];
    let thinkingText = '';  // Accumulates all thinking/reasoning text across iterations

    // Build message history -> STATEFUL (carries across messages)
    const systemPrompt = this.getSystemPrompt();
    let history: Message[] = conversationHistory
      ? [...conversationHistory, { role: 'user' as const, content: userMessage }]
      : [
          { role: 'system' as const, content: systemPrompt },
          { role: 'user' as const, content: userMessage },
        ];

    // Compress if too long
    if (history.length > 60) {
      history = this.compressHistory(history);
    }

    // === TOOL CALLING LOOP (1 API call per iteration) ===
    this.llmLog('CHAT_LOOP_START', { sessionId: this._sessionId, maxIterations: this._maxIterations, historyLen: history.length, model: this._model });

    for (let iteration = 0; iteration < this._maxIterations; iteration++) {
      const currentCalls = sessionCallCounts.get(this._sessionId) || 0;
      if (currentCalls >= this._maxCallsPerSession) {
        this.llmLog('CHAT_MAX_CALLS', { sessionId: this._sessionId, maxCalls: this._maxCallsPerSession });
        history.push({ role: 'user', content: 'Max API calls per session reached. Summarize what you accomplished so far.' });
        const summaryResponse = await this.callLLM(history, []);
        return {
          response: summaryResponse?.choices?.[0]?.message?.content || 'Max API calls reached.',
          history, requiresReload, toolSteps: allToolSteps, cost: this.getCost(), thinkingText
        };
      }

      this.llmLog('CHAT_ITERATION', { iteration: iteration + 1, maxIterations: this._maxIterations, historyLen: history.length, apiCallsSoFar: this._cost.apiCalls });
      onThinking?.('Thinking... (step ' + (iteration + 1) + ')');

      // Use streaming if onTextDelta callback provided
      if (onTextDelta) {
        const streamResult = await new Promise<any>((resolve, reject) => {
          this.callLLMStream(
            history,
            tools,
            (delta) => onTextDelta(delta),
            (fullResponse) => resolve(fullResponse),
            (err) => reject(err),
            onThinkingDelta,
          );
        });

        if (!streamResult?.choices || streamResult.choices.length === 0) {
          throw new Error('Empty choices from LLM stream.');
        }

        const assistantMsg = streamResult.choices[0].message;
        if (!assistantMsg) throw new Error('Empty message from LLM stream');

        this.trackApiCall(streamResult);

        history.push({
          role: 'assistant',
          // Some models (gpt-oss via Ollama) put the answer in reasoning/thinking instead of content
          content: assistantMsg.content || assistantMsg.reasoning || assistantMsg.thinking || null,
          tool_calls: assistantMsg.tool_calls,
        });

        // No tool calls = final answer
        if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) {
          // Some models (gpt-oss via Ollama) put the answer in reasoning/thinking instead of content
          const finalAnswer = assistantMsg.content || assistantMsg.reasoning || assistantMsg.thinking || 'Done.';
          console.log('[Agent] ' + (Date.now() - startTime) + 'ms, ' + this._cost.apiCalls + ' call(s) [streaming]');

          if (this._memorySystem) {
            this._memorySystem.extractAndSaveFacts(userMessage, finalAnswer);
          }

          return { response: finalAnswer, history, requiresReload, toolSteps: allToolSteps, cost: this.getCost(), thinkingText };
        }

        if (!assistantMsg.content || assistantMsg.content.trim().length === 0) {
          onThinking?.('Step ' + (iteration + 1) + ': Executing ' + assistantMsg.tool_calls.length + ' tool(s)...');
        }

        // Execute ALL tools in PARALLEL
        // Wrap onToolStep to also call persistent _onToolStepCallback
        const wrappedOnToolStep: ToolStepCallback = (step) => {
          onToolStep?.(step);
          this._onToolStepCallback?.(step);
        };
        const toolCallResults = await this.executeToolCallsParallel(
          assistantMsg.tool_calls,
          allToolSteps,
          wrappedOnToolStep,
          onThinking,
        );

        for (const { tc, result, error } of toolCallResults) {
          history.push({
            role: 'tool',
            content: error ? 'Error: ' + error : (result || '(no output)'),
            tool_call_id: tc.id,
            name: tc.function.name,
          });
        }

        onThinking?.('Synthesizing results from ' + toolCallResults.length + ' tool(s)...');
        continue;
      }

      // === Non-streaming fallback ===
      const toolResponse = await this.callLLM(history, tools);

      if (!toolResponse?.choices || toolResponse.choices.length === 0) {
        console.error('[Agent] Empty choices from LLM. Full response:', JSON.stringify(toolResponse));
        throw new Error('Empty response from LLM. The model may not support tool calling. Response: ' + JSON.stringify(toolResponse));
      }

      const assistantMsg = toolResponse.choices[0].message;
      if (!assistantMsg) throw new Error('Empty message from LLM');

      this.trackApiCall(toolResponse);

      history.push({
        role: 'assistant',
        // Some models (gpt-oss via Ollama) put the answer in reasoning/thinking instead of content
        content: assistantMsg.content || assistantMsg.reasoning || assistantMsg.thinking || null,
        tool_calls: assistantMsg.tool_calls,
      });

      // Accumulate thinking text — also capture reasoning/thinking fields from Ollama/gpt-oss
      const thinkingContent = assistantMsg.content || assistantMsg.reasoning || assistantMsg.thinking || '';
      if (thinkingContent.trim().length > 0) {
        thinkingText += thinkingContent.trim() + '\n';
        onThinking?.(thinkingContent.trim());
      }

      // No tool calls = final answer
      if (!assistantMsg.tool_calls || assistantMsg.tool_calls.length === 0) {
        // Some models (gpt-oss via Ollama) put the answer in reasoning/thinking instead of content
        const finalAnswer = assistantMsg.content || assistantMsg.reasoning || assistantMsg.thinking || 'Done.';
        console.log('[Agent] ' + (Date.now() - startTime) + 'ms, ' + this._cost.apiCalls + ' call(s)');

        if (this._memorySystem) {
          this._memorySystem.extractAndSaveFacts(userMessage, finalAnswer);
        }

        return { response: finalAnswer, history, requiresReload, toolSteps: allToolSteps, cost: this.getCost(), thinkingText };
      }

      if (!assistantMsg.content || assistantMsg.content.trim().length === 0) {
        onThinking?.('Step ' + (iteration + 1) + ': Executing ' + assistantMsg.tool_calls.length + ' tool(s)...');
      }

      // Execute ALL tools in PARALLEL
      // Wrap onToolStep to also call persistent _onToolStepCallback
      const wrappedOnToolStep: ToolStepCallback = (step) => {
        onToolStep?.(step);
        this._onToolStepCallback?.(step);
      };
      const toolCallResults = await this.executeToolCallsParallel(
        assistantMsg.tool_calls,
        allToolSteps,
        wrappedOnToolStep,
        onThinking,
      );

      for (const { tc, result, error } of toolCallResults) {
        history.push({
          role: 'tool',
          content: error ? 'Error: ' + error : (result || '(no output)'),
          tool_call_id: tc.id,
          name: tc.function.name,
        });
      }

      onThinking?.('Synthesizing results from ' + toolCallResults.length + ' tool(s)...');
    }

    // Max iterations -> force synthesis
    onThinking?.('Wrapping up...');
    history.push({ role: 'user', content: 'Max iterations reached. Summarize what you accomplished.' });
    const summaryResponse = await this.callLLM(history, []);
    const summary = summaryResponse?.choices?.[0]?.message?.content || 'Task partially completed (max iterations reached).';
    this.trackApiCall(summaryResponse);
    console.log('[Agent] ' + (Date.now() - startTime) + 'ms, ' + this._cost.apiCalls + ' call(s)');
    return { response: summary, history, requiresReload, toolSteps: allToolSteps, cost: this.getCost(), thinkingText };
  }

  // -- Resolve the correct chat/completions endpoint URL -------------------
  // Ollama (local or ngrok) uses /v1/chat/completions, not /chat/completions
  // OpenRouter and other OpenAI-compatible proxies use /chat/completions
  private getCompletionsURL(): string {
    const url = this.baseURL;
    // Detect Ollama: local ports 11434, or ngrok tunnels, or paths already containing /v1
    const isOllama = url.includes(':11434') || url.includes('ngrok') || url.includes('ollama');
    if (isOllama) {
      return url.replace(/\/+$/, '') + '/v1/chat/completions';
    }
    return url.replace(/\/+$/, '') + '/chat/completions';
  }

  // -- Track API call and enforce limits --------------------------------
  private trackApiCall(response: any): void {
    if (response?.usage) {
      this._cost.inputTokens += response.usage.prompt_tokens || 0;
      this._cost.outputTokens += response.usage.completion_tokens || 0;
    }
    this._cost.apiCalls++;
    this._cost.estimatedCost = this.estimateCost(this._cost.inputTokens, this._cost.outputTokens);
    // Also track per-session
    const current = sessionCallCounts.get(this._sessionId) || 0;
    sessionCallCounts.set(this._sessionId, current + 1);
  }

  // -- Execute tool calls in PARALLEL ----------------------------------
  private async executeToolCallsParallel(
    toolCalls: ToolCall[],
    allToolSteps: ToolStep[],
    onToolStep?: ToolStepCallback,
    onThinking?: (text: string) => void,
  ): Promise<Array<{ tc: ToolCall; result: string | null; error: string | null }>> {

    const parsedCalls: Array<{ tc: ToolCall; toolName: string; toolArgs: Record<string, unknown> }> = [];

    for (const tc of toolCalls) {
      let toolArgs: Record<string, unknown> = {};
      try { toolArgs = JSON.parse(tc.function.arguments || '{}'); } catch (parseErr) { this.toolLog('PARSE_ERROR', { toolCallId: tc.id, error: String(parseErr) }); toolArgs = {}; }
      parsedCalls.push({ tc, toolName: tc.function.name, toolArgs });
    }

    this.toolLog('PARALLEL_START', {
      count: parsedCalls.length,
      tools: parsedCalls.map(c => ({ name: c.toolName, id: c.tc.id })),
    });

    const batchStart = Date.now();

    // Fire "running" for all
    for (const { tc, toolName, toolArgs } of parsedCalls) {
      const label = '-> ' + toolName + (toolArgs.path ? ' (' + toolArgs.path + ')' : toolArgs.command ? ' (' + String(toolArgs.command).substring(0, 40) + ')' : '');
      onThinking?.(label);
      onToolStep?.({ id: tc.id, toolName, toolArgs, status: 'running' });
    }

    // Execute ALL in parallel
    const executionPromises = parsedCalls.map(async ({ tc, toolName, toolArgs }) => {
      const toolStart = Date.now();
      try {
        const result = await this.executeSingleTool(toolName, toolArgs);
        const duration = Date.now() - toolStart;
        const truncatedResult = this.truncateToolResult(result, toolName);
        const step: ToolStep = { id: tc.id, toolName, toolArgs, status: 'done', result: truncatedResult, duration };
        this.extractToolMetadata(step, toolName, result, toolArgs);
        allToolSteps.push(step);
        onToolStep?.(step);
        return { tc, result: truncatedResult, error: null };
      } catch (err: unknown) {
        const errMsg = (err as Error).message;
        const duration = Date.now() - toolStart;
        const step: ToolStep = { id: tc.id, toolName, toolArgs, status: 'error', result: errMsg, duration };
        allToolSteps.push(step);
        onToolStep?.(step);
        return { tc, result: null, error: errMsg };
      }
    });

    const results = await Promise.allSettled(executionPromises);
    const settledResults: Array<{ tc: ToolCall; result: string | null; error: string | null }> = results.map((r, i) => {
      if (r.status === 'fulfilled') return r.value;
      // This shouldn't happen since executeSingleTool catches errors, but just in case:
      const tc = parsedCalls[i].tc;
      return { tc, result: null, error: r.reason?.message || String(r.reason) };
    });

    const batchElapsed = Date.now() - batchStart;
    const successCount = settledResults.filter(r => r.error === null).length;
    const failCount = settledResults.filter(r => r.error !== null).length;
    const toolDurations = settledResults.map(r => ({ name: r.tc.function.name, id: r.tc.id, error: r.error !== null }));

    this.toolLog('PARALLEL_DONE', {
      totalMs: batchElapsed,
      count: settledResults.length,
      successCount,
      failCount,
      tools: toolDurations,
    });

    if (failCount > 0) {
      onThinking?.(successCount + ' succeeded, ' + failCount + ' failed.');
    }

    return settledResults;
  }

  // -- Execute single tool (with spawn_agent support) ------------------
  private async executeSingleTool(toolName: string, toolArgs: Record<string, unknown>): Promise<string> {
    this.toolLog('SINGLE_START', { toolName, argKeys: Object.keys(toolArgs), argSummary: this.summarizeArgs(toolArgs) });
    const start = Date.now();
    try {
      let result: string;
      if (toolName === 'spawn_agent' && this.onSpawnAgent) {
        result = await this.onSpawnAgent(toolArgs.task as string, toolArgs.instructions as string);
      } else {
        result = await this.registry.execute(toolName, toolArgs);
      }
      const elapsed = Date.now() - start;
      this.toolLog('SINGLE_DONE', { toolName, elapsedMs: elapsed, resultLen: result.length, resultPreview: result.substring(0, 120) });
      return result;
    } catch (err) {
      const elapsed = Date.now() - start;
      this.toolLog('SINGLE_ERROR', { toolName, elapsedMs: elapsed, error: (err as Error).message });
      throw err;
    }
  }

  // -- Summarize tool args for logging (avoid huge logs) ---------------
  private summarizeArgs(args: Record<string, unknown>): Record<string, unknown> {
    const summary: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(args)) {
      if (typeof v === 'string' && v.length > 100) {
        summary[k] = v.substring(0, 100) + '...[len=' + v.length + ']';
      } else {
        summary[k] = v;
      }
    }
    return summary;
  }

  // -- Truncate tool results -------------------------------------------
  private truncateToolResult(result: string, toolName: string): string {
    if (!result) return result;
    if (result.length > MAX_TOOL_RESULT_CHARS * 2) {
      return result.substring(0, MAX_TOOL_RESULT_CHARS * 2) + '\n... [truncated, ' + result.length + ' chars total]';
    }
    if (toolName === 'read_file' && result.length > MAX_TOOL_RESULT_CHARS) {
      return result.substring(0, MAX_TOOL_RESULT_CHARS) + '\n... [truncated, ' + result.length + ' chars total]';
    }
    if (toolName === 'run_terminal' && result.length > MAX_TOOL_RESULT_CHARS) {
      return '... [truncated]\n' + result.substring(result.length - MAX_TOOL_RESULT_CHARS);
    }
    return result;
  }

  // -- Extract metadata for UI -----------------------------------------
  private extractToolMetadata(step: ToolStep, toolName: string, result: string, toolArgs: Record<string, unknown>): void {
    if (toolName === 'search_code') {
      const match = result?.match(/Found (\d+) matches? for "([^"]+)"(?: in (\d+) files)?/);
      if (match) {
        step.fileCount = match[3] ? parseInt(match[3]) : undefined;
        step.query = match[2] || toolArgs.pattern as string;
      }
      const lines = (result || '').split('\n');
      const matches: Array<{ file: string; line: string; text: string }> = [];
      for (const line of lines) {
        const m = line.match(/^\s+(.+?):(\d+)\s*[\u2192\u25B6\-]\s*(.+)/);
        if (m) matches.push({ file: m[1].trim(), line: m[2], text: m[3].trim() });
      }
      if (matches.length > 0) (step as any).matches = matches;
    }
    if (toolName.startsWith('browser_')) {
      const urlMatch = result?.match(/Navigated to (.+)/);
      if (urlMatch) step.url = urlMatch[1].split('\n')[0].trim();
      const ssMatch = result?.match(/Screenshot: (.+)/);
      if (ssMatch) step.screenshot = ssMatch[1].trim();
      const selMatch = result?.match(/(?:Clicked|Typed .+ into|Get text|Assert .+ in) (.+?)(?:\n|"|$)/);
      if (selMatch) step.selector = selMatch[1].trim().replace(/"/g, '');
    }
    if (toolName === 'run_terminal') {
      step.command = toolArgs.command as string || '';
      step.output = result || '';
    }
    if (toolName === 'web_fetch') step.url = toolArgs.url as string;
    if (toolName === 'see_image' || toolName === 'assert_image_contains') step.url = toolArgs.path as string;
    if (toolName === 'android_screenshot') {
      const ssMatch = result?.match(/screenshot: (.+)/i);
      if (ssMatch) step.screenshot = ssMatch[1].trim();
    }
  }

  // -- Structured console logger --------------------------------------
  private llmLog(direction: string, data: Record<string, unknown>): void {
    const ts = new Date().toISOString();
    console.log('[LLM][' + ts + '][' + direction + '] ' + JSON.stringify(data));
  }

  private toolLog(phase: string, data: Record<string, unknown>): void {
    const ts = new Date().toISOString();
    console.log('[TOOL][' + ts + '][' + phase + '] ' + JSON.stringify(data));
  }

  private cardLog(cardType: string, data: Record<string, unknown>): void {
    const ts = new Date().toISOString();
    console.log('[CARD][' + ts + '][' + cardType + '] ' + JSON.stringify(data));
  }

  // -- LLM API call with retry (public for subclass/external access) ----
  async callLLM(messages: Message[], tools: object[]): Promise<any> {
    const controller = new AbortController();
    this._activeAbortController = controller;
    const timeout = setTimeout(() => controller.abort(), this._timeoutMs);
    if (this._abortSignal) {
      if (this._abortSignal.aborted) controller.abort();
      else this._abortSignal.addEventListener('abort', () => controller.abort(), { once: true });
    }
    const callStart = Date.now();
    try {
      const body: Record<string, unknown> = {
        model: this._model,
        messages,
        max_tokens: config.maxTokens,
      };

      if (tools.length > 0) {
        body.tools = tools;
        body.tool_choice = 'auto';
      }

      // Enable thinking/reasoning if configured (only for providers that support it)
      if (this._thinkingConfig) {
        const isAnthropic = this.baseURL.includes('anthropic') || this._model.startsWith('anthropic/');
        const isOpenRouter = this.baseURL.includes('openrouter');
        if (isAnthropic || isOpenRouter) {
          body.thinking = this._thinkingConfig;
          body.reasoning = { effort: this._thinkingEffort || 'medium' };
        }
      }

      // Log LLM request
      this.llmLog('REQUEST', {
        model: this._model,
        baseURL: this.baseURL,
        messageCount: messages.length,
        toolCount: tools.length,
        thinking: !!this._thinkingConfig,
        messages: messages.map(m => ({ role: m.role, contentLen: m.content?.length || 0, hasToolCalls: !!(m.tool_calls && m.tool_calls.length > 0), toolCallCount: m.tool_calls?.length || 0 })),
      });

      // Retry: 429/5xx get retried with backoff
      const MAX_RETRIES = config.maxRetries;
      const BASE_DELAY_MS = config.retryBaseDelayMs;
      let lastError = '';

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (attempt > 0) {
          const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
          this.llmLog('RETRY', { attempt, maxRetries: MAX_RETRIES, delayMs: delay, model: this._model });
          await new Promise(r => setTimeout(r, delay));
        }

        // Connection timeout: abort if HTTP response headers don't arrive in 30s
        const connectTimeout = AbortSignal.timeout(30_000);
        const response = await fetch(this.getCompletionsURL(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + this.apiKey },
          body: JSON.stringify(body),
          signal: AbortSignal.any([controller.signal, connectTimeout]),
        });

        this.llmLog('HTTP_STATUS', { status: response.status, ok: response.ok, attempt, model: this._model, url: this.getCompletionsURL() });

        if (response.ok) {
          const json: any = await response.json();
          const elapsed = Date.now() - callStart;
          this.llmLog('RESPONSE', {
            model: this._model,
            elapsedMs: elapsed,
            choicesCount: json.choices?.length || 0,
            hasToolCalls: !!(json.choices?.[0]?.message?.tool_calls?.length),
            toolCallCount: json.choices?.[0]?.message?.tool_calls?.length || 0,
            contentLen: json.choices?.[0]?.message?.content?.length || 0,
            toolCalls: json.choices?.[0]?.message?.tool_calls?.map((tc: any) => ({ id: tc.id, name: tc.function?.name, argsLen: tc.function?.arguments?.length || 0 })),
            usage: json.usage,
            tokens: { input: json.usage?.prompt_tokens || 0, output: json.usage?.completion_tokens || 0, total: (json.usage?.prompt_tokens || 0) + (json.usage?.completion_tokens || 0) },
          });
          return json;
        }

        const text = await response.text();
        this.llmLog('ERROR_BODY', { status: response.status, bodyLen: text.length, bodyPreview: text.substring(0, 300) });
        // Don't include raw HTML bodies in error messages — extract clean text only
        const _cleanText = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 200);
        lastError = 'API ' + response.status + (_cleanText ? ': ' + _cleanText : '');

        if (response.status === 401) {
          this.llmLog('ERROR_FATAL', { status: 401, reason: 'Unauthorized', message: 'API key is invalid or expired' });
          throw new Error('401 Unauthorized: API key is invalid or expired. Fix: Check your API key in .env for the active provider. Details: ' + lastError);
        }

        if (response.status === 403) {
          this.llmLog('ERROR_FATAL', { status: 403, reason: 'Forbidden', model: this._model, message: 'No model access' });
          throw new Error('403 Forbidden: Your API key does not have access to model "' + this._model + '". Check your plan or switch models. Details: ' + lastError);
        }

        if (response.status === 404) {
          this.llmLog('ERROR_FATAL', { status: 404, reason: 'Model not found', model: this._model, baseURL: this.baseURL });
          throw new Error('404 Model not found: "' + this._model + '" is not available at ' + this.baseURL + '. Check MODEL in .env. Details: ' + lastError);
        }

        if (response.status === 429 || (response.status >= 500 && response.status < 600)) {
          if (attempt < MAX_RETRIES) {
            this.llmLog('ERROR_RETRYABLE', { status: response.status, attempt, maxRetries: MAX_RETRIES });
            continue;
          }
          this.llmLog('ERROR_EXHAUSTED', { status: response.status, attempts: attempt + 1, lastError });
          throw new Error('Failed after ' + MAX_RETRIES + ' retries. ' + lastError);
        }

        throw new Error(lastError);
      }

      throw new Error('Exhausted retries. ' + lastError);
    } catch (err) {
      const elapsed = Date.now() - callStart;
      this.llmLog('FAILED', { elapsedMs: elapsed, error: (err as Error).message });
      throw err;
    } finally { clearTimeout(timeout); }
  }

  // -- Streaming LLM call: yields SSE chunks as they arrive ----------------
  // onTextDelta: called for each content token chunk
  // onThinkingDelta: called for each reasoning/thinking token chunk (optional)
  // onDone: called when stream completes with full response
  // onError: called on error
  async callLLMStream(
    messages: Message[],
    tools: object[],
    onTextDelta: (text: string) => void,
    onDone: (fullResponse: any) => void,
    onError: (err: Error) => void,
    onThinkingDelta?: (text: string) => void,
  ): Promise<void> {
    const controller = new AbortController();
    this._activeAbortController = controller;
    // Cap stream timeout at 120s — if the LLM doesn't respond in 2 min, something is wrong
    const HARD_TIMEOUT_MS = Math.min(this._timeoutMs, 120_000);
    const timeout = setTimeout(() => controller.abort(), HARD_TIMEOUT_MS);
    if (this._abortSignal) {
      if (this._abortSignal.aborted) controller.abort();
      else this._abortSignal.addEventListener('abort', () => controller.abort(), { once: true });
    }
    const streamStart = Date.now();

    // Log stream request
    this.llmLog('STREAM_REQUEST', {
      model: this._model,
      baseURL: this.baseURL,
      messageCount: messages.length,
      toolCount: tools.length,
      messages: messages.map(m => ({ role: m.role, contentLen: m.content?.length || 0, hasToolCalls: !!(m.tool_calls && m.tool_calls.length > 0), toolCallCount: m.tool_calls?.length || 0 })),
    });

    const body: Record<string, unknown> = {
      model: this._model,
      messages,
      stream: true,
      max_tokens: config.maxTokens,
    };
    if (tools.length > 0) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }

    // Enable thinking/reasoning if configured (only for providers that support it)
    if (this._thinkingConfig) {
      const isAnthropic = this.baseURL.includes('anthropic') || this._model.startsWith('anthropic/');
      const isOpenRouter = this.baseURL.includes('openrouter');
      if (isAnthropic || isOpenRouter) {
        body.thinking = this._thinkingConfig;
        body.reasoning = { effort: this._thinkingEffort || 'medium' };
      }
    }

    const MAX_RETRIES = config.maxRetries;
    const BASE_DELAY_MS = config.retryBaseDelayMs;
    let lastError = '';
    let firstTokenLogged = false;
    let chunkCount = 0;

    // Helper: always clear timeout before any exit
    let finished = false;
    const finish = () => {
      if (!finished) { finished = true; clearTimeout(timeout); }
    };

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      // Check abort signal before each attempt
      if (controller.signal.aborted) { finish(); onError(new Error('Request aborted')); return; }
      if (this._abortSignal?.aborted) { controller.abort(); finish(); onError(new Error('Request aborted')); return; }

      if (attempt > 0) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
        this.llmLog('STREAM_RETRY', { attempt, maxRetries: MAX_RETRIES, delayMs: delay, model: this._model });
        await new Promise(r => setTimeout(r, delay));
        // Check abort again after delay
        if (controller.signal.aborted || this._abortSignal?.aborted) { finish(); onError(new Error('Request aborted')); return; }
      }

      try {
        this.llmLog('STREAM_CONNECT', { model: this._model, url: this.getCompletionsURL(), attempt });

        // Connection timeout: abort if HTTP response headers don't arrive in 30s
        const connectTimeout = AbortSignal.timeout(30_000);
        const response = await fetch(this.getCompletionsURL(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + this.apiKey },
          body: JSON.stringify(body),
          signal: AbortSignal.any([controller.signal, connectTimeout]),
        });

        this.llmLog('STREAM_HTTP_STATUS', { status: response.status, ok: response.ok, attempt, model: this._model });

        if (!response.ok) {
          const text = await response.text();
          this.llmLog('STREAM_ERROR_BODY', { status: response.status, bodyLen: text.length, bodyPreview: text.substring(0, 300) });
          const _cleanTextS = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 200);
          lastError = 'API ' + response.status + (_cleanTextS ? ': ' + _cleanTextS : '');

          if (response.status === 401) { finish(); this.llmLog('STREAM_ERROR_FATAL', { status: 401, reason: 'Unauthorized' }); onError(new Error('401 Unauthorized: Check API key.')); return; }
          if (response.status === 403) { finish(); this.llmLog('STREAM_ERROR_FATAL', { status: 403, reason: 'Forbidden' }); onError(new Error('403 Forbidden: No model access.')); return; }
          if (response.status === 404) { finish(); this.llmLog('STREAM_ERROR_FATAL', { status: 404, reason: 'Model not found' }); onError(new Error('404 Model not found.')); return; }
          if (response.status === 429 || response.status >= 500) {
            if (attempt < MAX_RETRIES) { this.llmLog('STREAM_ERROR_RETRYABLE', { status: response.status, attempt }); continue; }
            finish(); this.llmLog('STREAM_ERROR_EXHAUSTED', { status: response.status, attempts: attempt + 1 }); onError(new Error('Failed after retries: ' + lastError)); return;
          }
          finish(); onError(new Error(lastError)); return;
        }

        // Parse SSE stream
        const reader = response.body?.getReader();
        if (!reader) { finish(); onError(new Error('No response body')); return; }

        const decoder = new TextDecoder();
        let fullContent = '';
        let fullThinking = '';
        let fullToolCalls: any[] = [];
        let buffer = '';
        let usage: any = null;
        let lastDataTime = Date.now();
        const STREAM_READ_TIMEOUT_MS = 60_000; // 60s without data = dead connection

        // Helper: read with timeout to detect dead connections
        const readWithTimeout = (): Promise<{ done: boolean; value: Uint8Array | undefined }> => {
          return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
              reject(new Error('Stream read timeout — no data received for ' + (STREAM_READ_TIMEOUT_MS / 1000) + 's. The LLM endpoint may be unreachable or the connection dropped.'));
            }, STREAM_READ_TIMEOUT_MS);
            reader.read().then((result: any) => {
              clearTimeout(timer);
              lastDataTime = Date.now();
              resolve(result as { done: boolean; value: Uint8Array | undefined });
            }).catch((err) => {
              clearTimeout(timer);
              reject(err);
            });
          });
        };

        while (true) {
          const { done, value } = await readWithTimeout();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // Keep incomplete line

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data: ')) continue;
            const data = trimmed.substring(6);
            if (data === '[DONE]') break;

            try {
              const chunk = JSON.parse(data);
              chunkCount++;
              const choice = chunk.choices?.[0];
              if (!choice) continue;

              // Log first token arrival
              if (!firstTokenLogged) {
                firstTokenLogged = true;
                this.llmLog('STREAM_FIRST_TOKEN', { model: this._model, elapsedMs: Date.now() - streamStart });
              }

              // Text delta
              const delta = choice.delta;

              // Thinking/reasoning delta — OpenRouter sends reasoning_details, Ollama sends reasoning/reasoning_content, some APIs send thinking_delta
              const thinkingDelta = delta?.reasoning_details || delta?.reasoning_content || delta?.reasoning || delta?.thinking || delta?.thinking_delta;
              if (thinkingDelta) {
                fullThinking += thinkingDelta;
                onThinkingDelta?.(thinkingDelta);
              }

              // Content delta (the actual answer text)
              if (delta?.content) {
                fullContent += delta.content;
                onTextDelta(delta.content);
              }

              // Tool call deltas (accumulate)
              if (delta?.tool_calls) {
                for (const tc of delta.tool_calls) {
                  const idx = tc.index;
                  if (idx == null) continue;
                  if (!fullToolCalls[idx]) {
                    fullToolCalls[idx] = {
                      id: tc.id || '',
                      type: 'function',
                      function: {
                        name: tc.function?.name || '',
                        arguments: tc.function?.arguments || '',
                      },
                    };
                  } else {
                    if (tc.function?.arguments) {
                      fullToolCalls[idx].function.arguments += tc.function.arguments;
                    }
                    if (tc.id) fullToolCalls[idx].id = tc.id;
                    // Only update name if it's actually non-empty (avoid overwriting with '')
                    if (tc.function?.name && tc.function.name.length > 0) {
                      fullToolCalls[idx].function.name = tc.function.name;
                    }
                  }
                }
              }

              // Usage
              if (chunk.usage) usage = chunk.usage;
            } catch {
              // Skip malformed JSON
            }
          }
        }

        // Build final response shape matching non-streaming format
        const finalResponse = {
          choices: [{
            message: {
              role: 'assistant',
              content: fullContent || null,
              tool_calls: fullToolCalls.length > 0 ? fullToolCalls : undefined,
            },
          }],
          usage: usage || { prompt_tokens: 0, completion_tokens: 0 },
        };

        const elapsed = Date.now() - streamStart;
        this.llmLog('STREAM_DONE', {
          model: this._model,
          elapsedMs: elapsed,
          chunkCount,
          contentLen: fullContent.length,
          hasToolCalls: fullToolCalls.length > 0,
          toolCallCount: fullToolCalls.length,
          toolCalls: fullToolCalls.map((tc: any) => ({ id: tc.id, name: tc.function?.name, argsLen: tc.function?.arguments?.length || 0 })),
          usage,
          tokens: { input: usage?.prompt_tokens || 0, output: usage?.completion_tokens || 0, total: (usage?.prompt_tokens || 0) + (usage?.completion_tokens || 0) },
        });

        finish();
        onDone(finalResponse);
        return;
      } catch (err) {
        const elapsed = Date.now() - streamStart;
        this.llmLog('STREAM_ERROR', { elapsedMs: elapsed, error: (err as Error).message, attempt });
        if (attempt >= MAX_RETRIES) {
          finish();
          onError(err as Error);
          return;
        }
      }
    }
    finish();
    onError(new Error('Exhausted retries. ' + lastError));
  }

  // -- Cost estimation (configurable prices) ---------------------------
  private estimateCost(inputTokens: number, outputTokens: number): number {
    const inputPricePerMillion = config.modelInputPrice;
    const outputPricePerMillion = config.modelOutputPrice;
    return (inputTokens / 1000000) * inputPricePerMillion + (outputTokens / 1000000) * outputPricePerMillion;
  }

  // -- System prompt ---------------------------------------------------
  private getSystemPrompt(): string {
    // Return cached prompt if nothing changed
    if (!this._systemPromptDirty && this._cachedSystemPrompt) {
      return this._cachedSystemPrompt;
    }

    // 1. Base: custom or default
    let base = this._customSystemPrompt || DEFAULT_SYSTEM_PROMPT;

    // 2. Mode-specific additions
    const modeBlock = this._mode === 'chat'
      ? '\n## Mode: Chat\nRead-only mode. You can read files, search code, and explain concepts. You do NOT modify files. You do NOT run terminal commands. Focus on being helpful, clear, and concise.\n'
      : this._mode === 'plan'
        ? '\n## Mode: Plan\nPlanning mode. You create detailed execution plans but NEVER execute them. Analyze the task, read relevant files, and output a numbered plan with specific file paths and changes. Each step should specify: which file to modify, what change to make, and why. DO NOT execute any tools that modify files or run commands.\n'
      : '\n## Mode: Code\nFull agentic mode. You can read, write, edit, and delete files. You can run terminal commands. You have access to ALL tools. Be direct, efficient, and action-oriented. Always use tools to accomplish tasks — NEVER just describe what to do.\n';
    base = base + modeBlock;

    // 3. Shell info
    if (this._shellInfo) {
      const shellBlock = '\n## Terminal\n'
        + 'You are using the VS Code integrated terminal.\n'
        + 'Shell: ' + this._shellInfo.name + '\n'
        + 'Path: ' + this._shellInfo.path + '\n'
        + 'Platform: ' + this._shellInfo.platform + '\n'
        + 'Use the `run_terminal` tool to execute commands. '
        + 'Commands will be automatically routed through this shell.\n'
        + 'Use the appropriate syntax for this shell (e.g., '
        + (this._shellInfo.name.toLowerCase().includes('powershell') || this._shellInfo.name.toLowerCase().includes('pwsh')
          ? 'PowerShell cmdlets like Get-ChildItem, $env:VAR, etc.'
          : this._shellInfo.name.toLowerCase().includes('cmd')
            ? 'CMD commands like dir, echo %VAR%, etc.'
            : 'POSIX commands like ls, $VAR, etc.')
        + ').\n';
      base = base + shellBlock;
    }

    // 4. Memory + profile (from MemorySystem)
    if (this._memorySystem) {
      const memoryBlock = this._memorySystem.getMemoryBlock();
      const profileBlock = this._memorySystem.getProfileBlock();
      if (memoryBlock) base = base + '\n' + memoryBlock;
      if (profileBlock) base = base + '\n' + profileBlock;
    }

    // 5. Dynamic context (from extension: rules, flow state, current file, workspace)
    if (this._contextBuilder) {
      const ctx = this._contextBuilder();
      if (ctx) base = base + '\n' + ctx;
    }

    this._cachedSystemPrompt = base;
    this._systemPromptDirty = false;
    return base;
  }

  // -- Context compression -----------------------------------------------
  // When conversation gets too long, compress old messages into summaries
  // instead of dropping them. This is the Hermes approach: preserve the
  // information, just in a more compact form.
  private compressHistory(history: Message[]): Message[] {
    const COMPRESS_THRESHOLD = config.historyCompressThreshold;
    const KEEP_RECENT = config.historyKeepRecent;
    const SUMMARY_LINES = config.historyCompressSummaryLines;

    if (history.length <= COMPRESS_THRESHOLD) return history;

    const sysMsg = history.find(m => m.role === 'system');
    const recent = history.slice(-KEEP_RECENT);
    const old = history.slice(0, history.length - KEEP_RECENT);

    // Build a summary of old messages — preserve tool results, not just names
    const summaryParts: string[] = [];
    for (const msg of old) {
      if (msg.role === 'user' && msg.content) {
        summaryParts.push('User: ' + msg.content.substring(0, 100));
      } else if (msg.role === 'assistant' && msg.content) {
        summaryParts.push('Assistant: ' + msg.content.substring(0, 100));
      } else if (msg.role === 'tool' && msg.name) {
        // Preserve tool name + first 200 chars of result (not just "called")
        const content = msg.content || '';
        summaryParts.push('Tool: ' + msg.name + ' => ' + content.substring(0, 200));
      }
    }

    const summaryMsg: Message = {
      role: 'user',
      content: '[Conversation summary — earlier turns compressed]\n' +
        summaryParts.slice(-SUMMARY_LINES).join('\n') +
        '\n\n[Recent conversation follows]',
    };

    const result: Message[] = [];
    if (sysMsg) result.push(sysMsg);
    result.push(summaryMsg);
    result.push(...recent);

    return result;
  }
}

// -- System prompt -----------------------------------------------------
// Adapted from Hermes Agent's prompt_builder.py — three-tier architecture:
//   stable (identity + tool guidance) + context (workspace) + volatile (memory + timestamp)
const DEFAULT_SYSTEM_PROMPT =
  '# Identity\n' +
  'You are PulseCode AI, an autonomous AI coding agent inside VS Code.\n' +
  'You are direct, efficient, and action-oriented. Never over-explain.\n\n' +

  '# Tool-Use Enforcement\n' +
  'You MUST use your tools to take action — do not describe what you would do.\n' +
  'When you say you will perform an action, you MUST immediately make the\n' +
  'corresponding tool call in the same response. Never end your turn with a\n' +
  'promise of future action — execute it now.\n' +
  'Keep working until the task is actually complete. Every response should either\n' +
  '(a) contain tool calls that make progress, or (b) deliver a final result.\n' +
  'Responses that only describe intentions without acting are not acceptable.\n\n' +

  '# Execution Discipline\n' +
  '- Check if something exists before creating it. Use read_file/list_files to\n' +
  '  verify state before taking action.\n' +
  '- If a tool returns an error, do NOT retry the same call. Change strategy:\n' +
  '  use a different tool, check prerequisites, or report the blocker.\n' +
  '- For independent operations, call multiple tools in PARALLEL (one response\n' +
  '  with multiple tool_calls). For dependent operations, call sequentially.\n' +
  '- NEVER answer from memory what a tool can verify: file contents, system\n' +
  '  state, current time, git state, calculations — always use a tool.\n' +
  '- Before finalizing: verify correctness, grounding, and completeness.\n\n' +

  '# Finishing the Job\n' +
  'Deliver working artifacts backed by real tool output — not descriptions.\n' +
  'Do not stop after writing a stub, a plan, or a single command. Keep working\n' +
  'until you have actually exercised the code or produced the requested result.\n' +
  'If a tool, install, or network call fails and blocks the real path, say so\n' +
  'directly and try an alternative. NEVER substitute fabricated output\n' +
  '(made-up data, invented file contents, synthesised API responses) for results\n' +
  'you could not actually produce. Reporting a blocker honestly is always better\n' +
  'than inventing a result.\n\n' +

  '# Missing Context\n' +
  '- If required context is missing, do NOT guess or hallucinate.\n' +
  '- Use the appropriate lookup tool (search_code, web_search, read_file).\n' +
  '- Ask a clarifying question only when the information cannot be retrieved.\n' +
  '- If you must proceed with incomplete information, label assumptions explicitly.\n\n' +

  '# Response Format\n' +
  'Be concise. No headers like "Thought Process" or "Plan". Just act or answer.\n' +
  'When you have nothing more to do, respond with the final result only — do not\n' +
  'ask "what would you like me to do next?" or "is there anything else?".\n\n' +

  '# Thinking & Reasoning (MANDATORY)\n' +
  'You have an extended thinking capability. Use it for EVERY response that involves tool calls.\n\n' +
  '## Reasoning Before Each Tool Call\n' +
  'Before calling ANY tool, you MUST first output your reasoning. This reasoning is visible to the user in a "Thinking" card. Follow this pattern:\n\n' +
  '1. **Analyze the task**: What am I being asked to do? What do I already know?\n' +
  '2. **Plan the approach**: What steps do I need? What tools will I use? In what order?\n' +
  '3. **Explain each tool**: For EACH tool call, explain WHY you are calling it and WHAT you expect it to return.\n' +
  '4. **Anticipate errors**: What could go wrong? What will I do if it fails?\n\n' +
  '## Reasoning Format\n' +
  'Structure your thinking like this (the user sees this in real-time):\n' +
  '```\n' +
  'Task: [What I need to accomplish]\n' +
  'Step 1: [First action] → [tool_name] because [reason]\n' +
  'Step 2: [Second action] → [tool_name] because [reason]\n' +
  '...\n' +
  'Expected outcome: [What I expect to happen]\n' +
  '```\n\n' +
  '## After Tool Execution\n' +
  'After tools execute, provide a brief summary:\n' +
  '- What the tool returned (key findings, not full output)\n' +
  '- Whether it matched expectations\n' +
  '- What the next step is (or if the task is complete)\n\n' +
  '## Text Response\n' +
  'After all reasoning and tool execution, provide a clear text response that:\n' +
  '- Summarizes what was accomplished\n' +
  '- Explains any changes made\n' +
  '- Notes any issues or follow-up needed\n' +
  '- Is concise but informative (not just "Done")\n\n' +
  '## Examples\n' +
  'GOOD: "I need to read the config file to understand the current setup. I will use read_file to check package.json for dependencies, then search_code to find where those dependencies are used. This will help me understand the impact of the change."\n' +
  'BAD: "Let me check the files." (no reasoning about WHY or WHAT for)\n' +
  'GOOD: "The search found 3 matches in 2 files. The main logic is in src/handler.ts. I will edit this file to add the new endpoint, using the pattern I saw in the existing routes."\n' +
  'BAD: "Found some files. Editing now." (no context about what was found or why this file)';

  '# Single-Shot Execution (CRITICAL)\n' +
  'You have ONE response to complete the task. Do NOT plan to "come back later" or "in the next iteration".\n' +
  'If the task requires multiple steps, call ALL necessary tools in PARALLEL in a single response.\n' +
  'Example: if you need to read 3 files and then edit one, call read_file 3 times + edit_file once in the SAME response.\n' +
  'Only use sequential calls when one tool\'s output is needed as input for the next tool.\n' +
  'If you cannot complete the task in one response, do as much as possible and explain what remains.';
