// packages/shared/types/ag-ui.types.ts
// AG-UI Protocol — event types for real-time agent-frontend communication

export type AgentEvent =
  | { type: 'text-delta'; content: string }
  | { type: 'tool-call'; tool: string; args: Record<string, unknown>; id: string }
  | { type: 'tool-result'; tool: string; result: unknown; id: string }
  | { type: 'state-update'; status: string; details?: unknown }
  | { type: 'approval-request'; message: string; options: string[]; id: string }
  | { type: 'error'; message: string }
  | { type: 'done'; summary?: string };

export interface AgentRunRequest {
  query: string;
  sessionId?: string;
  filePath?: string;
  fileContent?: string;
  context?: string;
}

export interface AgentRunResponse {
  success: boolean;
  sessionId: string;
  error?: string;
}

export const SSE_HEADERS: Record<string, string> = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  'Connection': 'keep-alive',
  'X-Accel-Buffering': 'no',
};

export function formatSSE(event: AgentEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}
