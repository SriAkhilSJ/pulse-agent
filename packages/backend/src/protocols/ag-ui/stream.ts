// packages/backend/src/protocols/ag-ui/stream.ts
// AgentEventStream — EventEmitter-based event stream for agent execution

import { EventEmitter } from 'events';
import type { AgentEvent } from '@pulse-ide/shared';

export class AgentEventStream extends EventEmitter {
  private closed = false;

  constructor() {
    super();
    this.setMaxListeners(100);
  }

  /** Emit an agent event */
  emitEvent(event: AgentEvent): void {
    if (this.closed) return;
    this.emit('event', event);
  }

  /** Emit a text delta (streaming token) */
  textDelta(content: string): void {
    this.emitEvent({ type: 'text-delta', content });
  }

  /** Emit a tool call */
  toolCall(tool: string, args: Record<string, unknown>, id: string): void {
    this.emitEvent({ type: 'tool-call', tool, args, id });
  }

  /** Emit a tool result */
  toolResult(tool: string, result: unknown, id: string): void {
    this.emitEvent({ type: 'tool-result', tool, result, id });
  }

  /** Emit a state update */
  stateUpdate(status: string, details?: unknown): void {
    this.emitEvent({ type: 'state-update', status, details });
  }

  /** Emit an approval request */
  approvalRequest(message: string, options: string[], id: string): void {
    this.emitEvent({ type: 'approval-request', message, options, id });
  }

  /** Emit an error */
  error(message: string): void {
    this.emitEvent({ type: 'error', message });
  }

  /** Emit done */
  done(summary?: string): void {
    this.emitEvent({ type: 'done', summary });
  }

  /** Close the stream */
  close(): void {
    this.closed = true;
    this.emit('close');
    this.removeAllListeners();
  }

  /** Check if stream is closed */
  isClosed(): boolean {
    return this.closed;
  }

  /** Pipe events to an SSE response */
  pipeToSSE(res: { write: (data: string) => void; end: () => void }): void {
    const onEvent = (event: AgentEvent) => {
      if (this.closed) return;
      const data = `data: ${JSON.stringify(event)}\n\n`;
      res.write(data);
    };

    this.on('event', onEvent);

    this.on('close', () => {
      this.removeListener('event', onEvent);
      res.end();
    });
  }
}
