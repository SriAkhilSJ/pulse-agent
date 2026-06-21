// packages/frontend/src/hooks/useAgent.ts
// useAgent hook — connects to SSE endpoint and manages agent state

import { useCallback, useRef } from 'react';
import { useAgentStore } from '../store/agent-store.js';
import type { AgentEvent } from '@pulse-ide/shared';

const SSE_ENDPOINT = import.meta.env.VITE_SSE_URL || 'http://localhost:3001/api/agent/run';

export function useAgent() {
  const store = useAgentStore();
  const abortRef = useRef<AbortController | null>(null);
  const draftBufferRef = useRef('');
  const rafRef = useRef<number | null>(null);

  const flushDraftBuffer = useCallback(() => {
    if (draftBufferRef.current) {
      store.appendTextDelta(draftBufferRef.current);
      draftBufferRef.current = '';
    }
  }, [store]);

  const scheduleFlush = useCallback(() => {
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(() => {
        flushDraftBuffer();
        rafRef.current = null;
      });
    }
  }, [flushDraftBuffer]);

  const handleEvent = useCallback((event: AgentEvent) => {
    switch (event.type) {
      case 'text-delta':
        // Batch tokens into draft buffer for smooth rendering
        draftBufferRef.current += event.content;
        scheduleFlush();
        break;

      case 'tool-call':
        store.addToolCall({
          id: event.id,
          tool: event.tool,
          args: event.args,
          status: 'running',
        });
        store.updateStatus(`⚙️ Calling ${event.tool}...`);
        break;

      case 'tool-result':
        store.updateToolCall(event.id, {
          status: 'done',
          result: typeof event.result === 'string' ? event.result : JSON.stringify(event.result),
        });
        store.updateStatus(`✅ ${event.tool} completed`);
        break;

      case 'state-update':
        store.updateStatus(event.status);
        break;

      case 'approval-request':
        store.setPendingDiff({
          id: event.id,
          filePath: event.message,
          oldContent: '',
          newContent: '',
          explanation: event.message,
        });
        break;

      case 'error':
        store.setError(event.message);
        store.updateStatus('❌ Error');
        store.setIsStreaming(false);
        break;

      case 'done':
        flushDraftBuffer();
        store.updateStatus('✅ Done');
        store.setIsStreaming(false);
        break;
    }
  }, [store, scheduleFlush, flushDraftBuffer]);

  const sendQuery = useCallback(async (query: string, filePath?: string, fileContent?: string) => {
    // Cancel any existing connection
    if (abortRef.current) {
      abortRef.current.abort();
    }

    const controller = new AbortController();
    abortRef.current = controller;

    // Reset state
    store.reset();
    store.setIsStreaming(true);
    store.setSessionId(`session-${Date.now()}`);
    store.addMessage({
      id: `msg-${Date.now()}`,
      role: 'user',
      content: query,
      timestamp: Date.now(),
    });

    try {
      const response = await fetch(SSE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          filePath: filePath || '',
          fileContent: fileContent || '',
          sessionId: store.sessionId,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`SSE error: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const dataLine = line.trim();
          if (!dataLine || !dataLine.startsWith('data: ')) continue;

          try {
            const event = JSON.parse(dataLine.substring(6)) as AgentEvent;
            handleEvent(event);
          } catch {
            // Skip malformed events
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        store.setError(err.message);
        store.updateStatus('❌ Connection failed');
      }
    } finally {
      store.setIsStreaming(false);
      flushDraftBuffer();
    }
  }, [store, handleEvent, flushDraftBuffer]);

  const stopQuery = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    store.setIsStreaming(false);
    store.updateStatus('⏹️ Stopped');
  }, [store]);

  const acceptDiff = useCallback(() => {
    store.acceptDiff();
  }, [store]);

  const rejectDiff = useCallback(() => {
    store.rejectDiff();
  }, [store]);

  return {
    sendQuery,
    stopQuery,
    acceptDiff,
    rejectDiff,
  };
}
