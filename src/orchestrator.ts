// src/orchestrator.ts
// Single-to-Multi-Agent Orchestrator — 2 API calls total
//
// Architecture: ONE agent, ONE tool loop (Claude Code / Cursor pattern).
// The agent has ALL tools merged (code + browser + desktop + android + audio).
// When the LLM returns multiple tool_calls in one response, execute in parallel.

import { ToolRegistry } from './tool-registry';
import { Agent, Message, ShellInfo } from './agent';
import { config } from './config';

export type AgentType = 'browser' | 'desktop' | 'ask' | 'android' | 'audio' | 'code' | 'plan';

export interface AgentTypeInfo {
  type: AgentType;
  label: string;
  icon: string;
  color: string;
  systemPrompt: string;
  defaultTools: string[];
}

export const AGENT_TYPES: Record<AgentType, AgentTypeInfo> = {
  plan: { type: 'plan', label: 'Planner', icon: 'PLAN', color: '#b794f6', systemPrompt: 'You are a Plan Agent. Create detailed step-by-step plans. Read the codebase first. Output numbered steps with agent type assignments. DO NOT execute anything.', defaultTools: ['read_file', 'list_files', 'get_current_file', 'search_code', 'run_terminal'] },
  code: { type: 'code', label: 'Coder', icon: 'CODE', color: '#75beff', systemPrompt: 'You are a Code Agent. Write clean code. Use read_file, write_file, run_terminal. Always verify. Create real files with complete content.', defaultTools: ['read_file', 'write_file', 'edit_file', 'delete_file', 'list_files', 'get_current_file', 'search_code', 'run_terminal'] },
  browser: { type: 'browser', label: 'Browser', icon: 'BROWSER', color: '#89d185', systemPrompt: 'You are a Browser Agent. Use run_terminal + playwright for browser automation. Navigate, click, type, screenshot take after EVERY action. Report what you see.', defaultTools: ['run_terminal', 'read_file', 'write_file', 'see_image', 'browser_navigate', 'browser_click', 'browser_type', 'browser_screenshot', 'browser_assert_text', 'browser_get_text'] },
  desktop: { type: 'desktop', label: 'Desktop', icon: 'DESKTOP', color: '#cca700', systemPrompt: 'You are a Desktop Agent. Use run_terminal for system commands. Full system access via bash. Manage files, run programs, install packages.', defaultTools: ['run_terminal', 'read_file', 'write_file', 'edit_file', 'delete_file', 'list_files', 'search_code'] },
  ask: { type: 'ask', label: 'Asker', icon: 'ASK', color: '#f14c4c', systemPrompt: 'You are an Ask Agent. Formulate clear questions for the user. State the goal, the ambiguity, and options. Wait for response.', defaultTools: [] },
  android: { type: 'android', label: 'Android', icon: 'ANDROID', color: '#4ec9b0', systemPrompt: 'You are an Android Agent. Use ADB via run_terminal (adb devices, adb shell, adb install). Screenshots, tap, type. Verify device connection first.', defaultTools: ['run_terminal', 'read_file', 'write_file', 'android_devices', 'android_click', 'android_type', 'android_swipe', 'android_screenshot'] },
  audio: { type: 'audio', label: 'Audio', icon: 'AUDIO', color: '#c586c0', systemPrompt: 'You are an Audio Agent. Use run_terminal for audio ops (ffplay, aplay, whisper). Record, play, transcribe.', defaultTools: ['run_terminal', 'read_file', 'write_file', 'audio_record', 'audio_play', 'audio_transcribe'] },
};

export interface SubAgentConfig {
  id: string;
  type: AgentType;
  task: string;
  status: 'pending' | 'running' | 'done' | 'error';
  result?: string;
  error?: string;
  startedAt: number;
  finishedAt?: number;
  thinking?: string;
  toolCount: number;
}

export interface OrchestratorState {
  mode: 'single' | 'multi';
  phase: 'idle' | 'planning' | 'executing' | 'done' | 'error' | 'waiting_user';
  task: string;
  plan: string;
  agents: SubAgentConfig[];
  log: string[];
  parallelGroups: string[][];
  apiCalls: number;
}

export class Orchestrator {
  private apiKey: string;
  private baseURL: string;
  private model: string;
  private registry: ToolRegistry;
  private _shellInfo: ShellInfo | null = null;
  public state: OrchestratorState;
  private _mergedRegistry: ToolRegistry | null = null;
  private _registryVersion: number = 0;
  private _lastRegistryVersion: number = -1;

  constructor(apiKey: string, baseURL: string, registry: ToolRegistry, modelConfig?: { model?: string; shellInfo?: ShellInfo }) {
    this.apiKey = apiKey;
    this.baseURL = baseURL;
    this.registry = registry;
    this.model = modelConfig?.model || '';
    this._shellInfo = modelConfig?.shellInfo || null;
    this.state = { mode: 'single', phase: 'idle', task: '', plan: '', agents: [], log: [], parallelGroups: [], apiCalls: 0 };
  }

  /** Called by extension.ts when tools are added/removed at runtime */
  notifyRegistryChanged(): void {
    this._registryVersion++;
  }

  async auto(
    task: string,
    onAgentUpdate?: (agent: SubAgentConfig) => void,
    onThinking?: (agentId: string, agentName: string, text: string) => void,
    onToolStep?: (agentId: string, toolName: string, status: string, stepId?: string, toolArgs?: Record<string, unknown>, result?: string, duration?: number, url?: string, selector?: string, screenshot?: string, command?: string, output?: string, query?: string, fileCount?: number, matches?: Array<{file: string; line: string; text: string}>) => void,
  ): Promise<string> {
    this.state = { mode: 'multi', phase: 'executing', task, plan: '', agents: [], log: ['Starting workflow'], parallelGroups: [], apiCalls: 0 };

    const mergedRegistry = this.getFullMergedRegistry();

    const shellInfoBlock = this._shellInfo
      ? '\n## Terminal\nYou are using the VS Code integrated terminal.\nShell: ' + this._shellInfo.name + '\nPath: ' + this._shellInfo.path + '\nPlatform: ' + this._shellInfo.platform + '\nUse the `run_terminal` tool to execute commands.\n'
      : '';

    const systemPrompt = 'You are PulseCode AI, an autonomous multi-agent orchestrator.\n\n## Your Capabilities\nYou have access to ALL tools: file operations, terminal, browser, desktop, Android, audio, vision, web search, and more.\n\n## Rules\n1. ALWAYS use tools to accomplish tasks. NEVER just describe.\n2. NEVER say "I can\'t" — you have ALL tools.\n3. For independent tasks, call multiple tools in PARALLEL (one response with multiple tool_calls).\n4. For dependent tasks, call tools sequentially — wait for results before next step.\n5. After all steps are complete, provide a final synthesis as your text response.\n6. If a tool call fails, try to fix the error. If unrecoverable, skip and note why.\n' + shellInfoBlock;

    const agent = new Agent(this.apiKey, this.baseURL, mergedRegistry, {
      systemPrompt, maxIterations: config.maxIterations, model: this.model, shellInfo: this._shellInfo || undefined,
    });

    onThinking?.('main', 'PulseCode AI', 'Analyzing task...');

    const mainConfig: SubAgentConfig = { id: 'main', type: 'code', task, status: 'running', startedAt: Date.now(), toolCount: 0 };
    this.state.agents.push(mainConfig);
    onAgentUpdate?.(mainConfig);

    const result = await agent.chat(task, undefined, (step) => {
      mainConfig.toolCount++;
      onToolStep?.('main', step.toolName, step.status, step.id, step.toolArgs, step.result, step.duration, step.url, step.selector, step.screenshot, step.command, step.output, step.query, step.fileCount, step.matches);
    }, (text) => {
      mainConfig.thinking = text; onThinking?.('main', 'PulseCode AI', text);
    });

    mainConfig.status = 'done';
    mainConfig.finishedAt = Date.now();
    mainConfig.result = result.response;
    mainConfig.thinking = 'Completed in ' + result.cost.apiCalls + ' API calls';
    onAgentUpdate?.(mainConfig);
    onThinking?.('main', 'PulseCode AI', 'Completed in ' + result.cost.apiCalls + ' API calls');

    this.state.phase = 'done';
    this.state.apiCalls = result.cost.apiCalls;
    this.state.log.push('Completed in ' + result.cost.apiCalls + ' API calls');

    return result.response;
  }

  private getFullMergedRegistry(): ToolRegistry {
    if (this._mergedRegistry && this._registryVersion === this._lastRegistryVersion) return this._mergedRegistry;
    this._lastRegistryVersion = this._registryVersion;
    this._mergedRegistry = new ToolRegistry();
    const toolsSchema = this.registry.getToolsSchema() as any[];
    for (const toolDef of toolsSchema) {
      this._mergedRegistry.register({
        name: toolDef.function.name,
        description: toolDef.function.description,
        parameters: toolDef.function.parameters,
        handler: async (args: Record<string, unknown>): Promise<string> => {
          return this.registry.execute(toolDef.function.name, args);
        },
      });
    }
    return this._mergedRegistry;
  }

  invalidateMergedRegistry(): void { this._mergedRegistry = null; }

  async getPlan(task: string): Promise<string> {
    this.state.apiCalls++;
    const planAgent = new Agent(this.apiKey, this.baseURL, this.registry, { systemPrompt: 'You are a Plan Agent. Create detailed step-by-step plans. Analyze the task and output a numbered plan. Each step specifies which agent type handles it in [brackets]: [code], [browser], [desktop], [android], [audio], [ask]. DO NOT execute anything.', model: this.model });
    const result = await planAgent.chat(task);
    return result.response;
  }

  // Backward compatibility
  async runSingle(task: string, onThinking?: (text: string) => void, onToolStep?: (toolName: string, status: string, result?: string) => void): Promise<string> {
    this.state = { mode: 'single', phase: 'executing', task, plan: '', agents: [], log: ['Running in single-agent mode'], parallelGroups: [], apiCalls: 0 };
    const agent = new Agent(this.apiKey, this.baseURL, this.registry, { model: this.model });
    const result = await agent.chat(task, undefined, (step) => onToolStep?.(step.toolName, step.status, step.result), (text) => onThinking?.(text));
    this.state.phase = 'done';
    this.state.apiCalls = result.cost.apiCalls;
    return result.response;
  }

  async runMulti(task: string, onAgentUpdate?: (agent: SubAgentConfig) => void, onThinking?: (agentId: string, agentName: string, text: string) => void, onToolStep?: (agentId: string, toolName: string, status: string, stepId?: string, toolArgs?: Record<string, unknown>, result?: string, duration?: number, url?: string, selector?: string, screenshot?: string, command?: string, output?: string, query?: string, fileCount?: number, matches?: Array<{file: string; line: string; text: string}>) => void): Promise<string> {
    return this.auto(task, onAgentUpdate, onThinking, onToolStep);
  }

  reset(): void { this.state = { mode: this.state.mode, phase: 'idle', task: '', plan: '', agents: [], log: [], parallelGroups: [], apiCalls: 0 }; }
}
