import type { Message, ToolCall, ToolStep, AgentConfig, LLMConfig, ShellInfo } from '@pulse-ide/shared';
import { ToolRegistry } from './tool-registry.js';
export type { Message, ToolCall, ToolStep, AgentConfig, LLMConfig, ShellInfo };
export declare class Agent {
    private apiKey;
    private baseURL;
    private model;
    private registry;
    private shellInfo?;
    private abortSignal?;
    private onToolStepCallback?;
    private contextBuilder?;
    private memorySystem?;
    private thinkingConfig;
    private reasoningEffort;
    private _activeAbortController?;
    private _askUserResolve?;
    private _permissionResolve?;
    constructor(apiKey: string, baseURL: string, registry: ToolRegistry, options?: {
        model?: string;
        shellInfo?: ShellInfo;
    });
    setApiKey(key: string): void;
    setBaseURL(url: string): void;
    setModel(model: string): void;
    setAbortSignal(signal: AbortSignal): void;
    setOnToolStepCallback(cb: (step: ToolStep) => void): void;
    setContextBuilder(fn: () => string): void;
    setMemorySystem(ms: any): void;
    setThinking(thinking: {
        type: string;
        budget_tokens: number;
    }, reasoningEffort?: string): void;
    chat(userMessage: string, conversationHistory?: Message[], onToolStep?: (step: ToolStep) => void, onThinking?: (text: string) => void, onTextDelta?: (text: string) => void, onThinkingDelta?: (text: string) => void): Promise<{
        response: string;
        messages: Message[];
    }>;
    private buildSystemPrompt;
    private callLLM;
    private handleStreaming;
}
//# sourceMappingURL=agent.d.ts.map