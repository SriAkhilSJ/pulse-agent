// packages/backend/src/protocols/ag-ui/stream.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentEventStream } from './stream.js';
import type { AgentEvent } from '@pulse-ide/shared';

describe('AgentEventStream', () => {
  let stream: AgentEventStream;

  beforeEach(() => {
    stream = new AgentEventStream();
  });

  it('should emit text-delta events', () => {
    const events: AgentEvent[] = [];
    stream.on('event', (e) => events.push(e));

    stream.textDelta('Hello');
    stream.textDelta(' world');

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ type: 'text-delta', content: 'Hello' });
    expect(events[1]).toEqual({ type: 'text-delta', content: ' world' });
  });

  it('should emit tool-call events', () => {
    const events: AgentEvent[] = [];
    stream.on('event', (e) => events.push(e));

    stream.toolCall('read_file', { path: 'test.ts' }, 'tool-1');

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: 'tool-call',
      tool: 'read_file',
      args: { path: 'test.ts' },
      id: 'tool-1',
    });
  });

  it('should emit tool-result events', () => {
    const events: AgentEvent[] = [];
    stream.on('event', (e) => events.push(e));

    stream.toolResult('read_file', 'file content here', 'tool-1');

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: 'tool-result',
      tool: 'read_file',
      result: 'file content here',
      id: 'tool-1',
    });
  });

  it('should emit state-update events', () => {
    const events: AgentEvent[] = [];
    stream.on('event', (e) => events.push(e));

    stream.stateUpdate('planning', { step: 1 });
    stream.stateUpdate('executing');

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ type: 'state-update', status: 'planning', details: { step: 1 } });
    expect(events[1]).toEqual({ type: 'state-update', status: 'executing', details: undefined });
  });

  it('should emit approval-request events', () => {
    const events: AgentEvent[] = [];
    stream.on('event', (e) => events.push(e));

    stream.approvalRequest('Delete file?', ['yes', 'no'], 'approval-1');

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: 'approval-request',
      message: 'Delete file?',
      options: ['yes', 'no'],
      id: 'approval-1',
    });
  });

  it('should emit error events', () => {
    const events: AgentEvent[] = [];
    stream.on('event', (e) => events.push(e));

    stream.error('Something went wrong');

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: 'error', message: 'Something went wrong' });
  });

  it('should emit done events', () => {
    const events: AgentEvent[] = [];
    stream.on('event', (e) => events.push(e));

    stream.done('Task complete');

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: 'done', summary: 'Task complete' });
  });

  it('should emit done without summary', () => {
    const events: AgentEvent[] = [];
    stream.on('event', (e) => events.push(e));

    stream.done();

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ type: 'done', summary: undefined });
  });

  it('should not emit events after close', () => {
    const events: AgentEvent[] = [];
    stream.on('event', (e) => events.push(e));

    stream.textDelta('before');
    stream.close();
    stream.textDelta('after');

    expect(events).toHaveLength(1);
    const firstEvent = events[0];
    expect(firstEvent.type).toBe('text-delta');
    if (firstEvent.type === 'text-delta') {
      expect(firstEvent.content).toBe('before');
    }
  });

  it('should report closed state', () => {
    expect(stream.isClosed()).toBe(false);
    stream.close();
    expect(stream.isClosed()).toBe(true);
  });

  it('should pipe events to SSE response', () => {
    const writtenData: string[] = [];
    const mockRes = {
      write: (data: string) => writtenData.push(data),
      end: vi.fn(),
    };

    stream.pipeToSSE(mockRes as any);

    stream.textDelta('Hello');
    stream.stateUpdate('done');
    stream.done('Complete');

    expect(writtenData).toHaveLength(3);
    expect(writtenData[0]).toBe('data: {"type":"text-delta","content":"Hello"}\n\n');
    expect(writtenData[1]).toBe('data: {"type":"state-update","status":"done"}\n\n');
    expect(writtenData[2]).toBe('data: {"type":"done","summary":"Complete"}\n\n');
  });

  it('should end SSE response on close', () => {
    const mockRes = {
      write: vi.fn(),
      end: vi.fn(),
    };

    stream.pipeToSSE(mockRes as any);
    stream.close();

    expect(mockRes.end).toHaveBeenCalledTimes(1);
  });

  it('should emit events in correct order for a full agent run', () => {
    const events: AgentEvent[] = [];
    stream.on('event', (e) => events.push(e));

    // Simulate a full agent run
    stream.stateUpdate('routing', { route: 'single_call' });
    stream.stateUpdate('single-call-start', { model: 'deepseek-r1:14b' });
    stream.toolCall('read_file', { path: 'auth.ts' }, 'tool-1');
    stream.toolResult('read_file', 'const user = {};', 'tool-1');
    stream.toolCall('edit_file', { path: 'auth.ts', old_text: 'user', new_text: 'customer' }, 'tool-2');
    stream.toolResult('edit_file', 'Edited auth.ts', 'tool-2');
    stream.textDelta('--- a/auth.ts\n+++ b/auth.ts\n@@ -1 +1 @@\n-const user = {};\n+const customer = {};');
    stream.stateUpdate('single-call-complete', { filePath: 'auth.ts' });
    stream.done('Renamed user to customer in auth.ts');

    // Verify order by type
    expect(events).toHaveLength(9);
    expect(events[0].type).toBe('state-update');
    expect(events[1].type).toBe('state-update');
    expect(events[2].type).toBe('tool-call');
    expect(events[3].type).toBe('tool-result');
    expect(events[4].type).toBe('tool-call');
    expect(events[5].type).toBe('tool-result');
    expect(events[6].type).toBe('text-delta');
    expect(events[7].type).toBe('state-update');
    expect(events[8].type).toBe('done');

    // Verify specific values using type narrowing
    const routingEvent = events[0];
    if (routingEvent.type === 'state-update') {
      expect(routingEvent.status).toBe('routing');
    }

    const toolCallEvent = events[2];
    if (toolCallEvent.type === 'tool-call') {
      expect(toolCallEvent.tool).toBe('read_file');
    }

    const doneEvent = events[8];
    if (doneEvent.type === 'done') {
      expect(doneEvent.summary).toBe('Renamed user to customer in auth.ts');
    }
  });
});
