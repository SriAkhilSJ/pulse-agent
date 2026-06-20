// packages/shared/types/checkpoint.types.ts
// Checkpointing — resume agent sessions after crash

export interface Checkpoint {
  id: string;
  sessionId: string;
  query: string;
  route: 'autocomplete' | 'single_call' | 'multi_call';
  status: 'running' | 'paused' | 'completed' | 'error';
  messages: CheckpointMessage[];
  currentPlan: string[];
  completedSteps: string[];
  filesRead: string[];
  fileChanges: CheckpointFileChange[];
  iteration: number;
  maxIterations: number;
  createdAt: number;
  updatedAt: number;
  error?: string;
}

export interface CheckpointMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolName?: string;
  timestamp: number;
}

export interface CheckpointFileChange {
  filePath: string;
  oldContent: string;
  newContent: string;
  timestamp: number;
}

export interface CheckpointConfig {
  dbPath: string;
  autoSaveIntervalMs: number;
  maxCheckpointsPerSession: number;
}

export function getDefaultCheckpointConfig(): CheckpointConfig {
  return {
    dbPath: process.env['CHECKPOINT_DB_PATH'] || './checkpoints.db',
    autoSaveIntervalMs: 5000,
    maxCheckpointsPerSession: 100,
  };
}
