// packages/frontend/src/store/agent-store.ts
// Zustand store for agent state management

import { create } from 'zustand';
import type { AgentEvent } from '@pulse-ide/shared';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  timestamp: number;
}

export interface ToolCall {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  status: 'running' | 'done' | 'error';
  result?: string;
  duration?: number;
}

export interface PendingDiff {
  id: string;
  filePath: string;
  oldContent: string;
  newContent: string;
  explanation: string;
}

export interface AgentState {
  messages: ChatMessage[];
  status: string;
  currentToolCalls: ToolCall[];
  pendingDiff: PendingDiff | null;
  sessionCost: number;
  isStreaming: boolean;
  sessionId: string;
  error: string | null;

  addMessage: (msg: ChatMessage) => void;
  appendTextDelta: (text: string) => void;
  updateStatus: (status: string) => void;
  addToolCall: (call: ToolCall) => void;
  updateToolCall: (id: string, updates: Partial<ToolCall>) => void;
  setPendingDiff: (diff: PendingDiff | null) => void;
  acceptDiff: () => void;
  rejectDiff: () => void;
  setSessionCost: (cost: number) => void;
  setIsStreaming: (v: boolean) => void;
  setSessionId: (id: string) => void;
  setError: (err: string | null) => void;
  reset: () => void;
}

export const useAgentStore = create<AgentState>((set, get) => ({
  messages: [],
  status: 'idle',
  currentToolCalls: [],
  pendingDiff: null,
  sessionCost: 0,
  isStreaming: false,
  sessionId: `session-${Date.now()}`,
  error: null,

  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),

  appendTextDelta: (text) => set((s) => {
    const messages = [...s.messages];
    const last = messages[messages.length - 1];
    if (last && last.role === 'assistant') {
      last.content += text;
    } else {
      messages.push({
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: text,
        timestamp: Date.now(),
      });
    }
    return { messages };
  }),

  updateStatus: (status) => set({ status }),

  addToolCall: (call) => set((s) => ({
    currentToolCalls: [...s.currentToolCalls, call],
  })),

  updateToolCall: (id, updates) => set((s) => ({
    currentToolCalls: s.currentToolCalls.map((c) =>
      c.id === id ? { ...c, ...updates } : c
    ),
  })),

  setPendingDiff: (diff) => set({ pendingDiff: diff }),

  acceptDiff: () => {
    const diff = get().pendingDiff;
    if (diff) {
      get().addMessage({
        id: `msg-${Date.now()}`,
        role: 'system',
        content: `✅ Accepted edit to ${diff.filePath}: ${diff.explanation}`,
        timestamp: Date.now(),
      });
    }
    set({ pendingDiff: null });
  },

  rejectDiff: () => {
    const diff = get().pendingDiff;
    if (diff) {
      get().addMessage({
        id: `msg-${Date.now()}`,
        role: 'system',
        content: `❌ Rejected edit to ${diff.filePath}`,
        timestamp: Date.now(),
      });
    }
    set({ pendingDiff: null });
  },

  setSessionCost: (cost) => set({ sessionCost: cost }),
  setIsStreaming: (v) => set({ isStreaming: v }),
  setSessionId: (id) => set({ sessionId: id }),
  setError: (err) => set({ error: err }),

  reset: () => set({
    messages: [],
    status: 'idle',
    currentToolCalls: [],
    pendingDiff: null,
    sessionCost: 0,
    isStreaming: false,
    error: null,
  }),
}));
