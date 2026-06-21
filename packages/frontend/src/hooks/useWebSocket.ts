// packages/frontend/src/hooks/useWebSocket.ts
// Legacy WebSocket hook — kept for backward compatibility
// New code should use useAgent.ts (SSE-based)

import { useEffect, useRef, useCallback } from 'react';
import { useAgentStore } from '../store/agent-store.js';

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://127.0.0.1:3001';

export function useWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const { addMessage, setIsStreaming, setSessionId } = useAgentStore();

  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('[WS] Connected to backend');
    };

    ws.onclose = () => {
      console.log('[WS] Disconnected from backend');
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleMessage(msg);
      } catch (err) {
        console.error('[WS] Parse error:', err);
      }
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, []);

  const handleMessage = useCallback((msg: any) => {
    switch (msg.type) {
      case 'textDelta':
        addMessage({
          id: `msg-${Date.now()}`,
          role: 'assistant',
          content: msg.text,
          timestamp: Date.now(),
        });
        break;
      case 'thinking':
        addMessage({
          id: `thinking-${Date.now()}`,
          role: 'assistant',
          content: `[Thinking] ${msg.text}`,
          timestamp: Date.now(),
        });
        break;
      case 'toolStep':
        addMessage({
          id: msg.step.id,
          role: 'tool',
          content: `[${msg.step.status}] ${msg.step.toolName}: ${msg.step.result || ''}`,
          toolName: msg.step.toolName,
          timestamp: Date.now(),
        });
        break;
      case 'response':
        setIsStreaming(false);
        break;
      case 'error':
        addMessage({
          id: `error-${Date.now()}`,
          role: 'system',
          content: `Error: ${msg.message}`,
          timestamp: Date.now(),
        });
        setIsStreaming(false);
        break;
    }
  }, [addMessage, setIsStreaming]);

  const sendMessage = useCallback((text: string, requestId: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'chat',
        text,
        requestId,
        sessionId: useAgentStore.getState().sessionId,
      }));
      setIsStreaming(true);
    }
  }, [setIsStreaming]);

  const sendEvent = useCallback((event: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(event));
    }
  }, []);

  return { sendMessage, sendEvent };
}
