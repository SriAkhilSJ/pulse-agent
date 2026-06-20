// Core message types for agent conversations

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

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, ToolProperty>;
    required: string[];
  };
  handler: ToolHandler;
}

export interface ToolProperty {
  type: string;
  description?: string;
  items?: { type: string; maxItems?: number };
  enum?: string[];
  maxItems?: number;
}

export type ToolHandler = (args: Record<string, unknown>) => Promise<string>;

export interface AgentConfig {
  model: string;
  apiKey: string;
  baseURL: string;
  maxIterations?: number;
  maxCallsPerSession?: number;
  streaming?: boolean;
  maxRetries?: number;
  llmTimeoutMs?: number;
  maxToolResultChars?: number;
  maxTokens?: number;
  temperature?: number;
}

export interface LLMConfig {
  apiKey: string;
  baseURL: string;
  model: string;
}

export interface ShellInfo {
  name: string;
  path: string;
  args: string[];
  platform: string;
}

export type AgentType = 'browser' | 'desktop' | 'ask' | 'android' | 'audio' | 'code' | 'plan';

export interface AgentTypeInfo {
  type: AgentType;
  label: string;
  icon: string;
  color: string;
  systemPrompt: string;
  defaultTools: string[];
}

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
  subagents: SubAgentConfig[];
  currentStep: number;
  totalSteps: number;
  error?: string;
}

export interface SessionMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: number;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
}

export interface Session {
  id: string;
  title: string;
  messages: SessionMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface MemoryEntry {
  id: string;
  content: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface FileChange {
  filePath: string;
  originalContent: string;
  newContent: string;
  timestamp: number;
  status: 'pending' | 'applied' | 'reverted';
}

export interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

export interface FileDiff {
  filePath: string;
  oldContent: string;
  newContent: string;
  hunks: DiffHunk[];
}
