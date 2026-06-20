// packages/shared/types/agent.types.ts
// Multi-Call Agent state types

export interface AgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  timestamp: number;
}

export interface AgentState {
  messages: AgentMessage[];
  currentPlan: string[];       // list of planned steps
  completedSteps: string[];
  filesRead: string[];
  fileChanges: import('./index.js').FileDiff[];
  validationErrors: string[];
  iteration: number;
  maxIterations: number;
  needsUserApproval: boolean;
  query: string;
  status: 'idle' | 'planning' | 'executing' | 'validating' | 'error' | 'done';
  error?: string;
}

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
  duration: number;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}
