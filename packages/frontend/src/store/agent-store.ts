// packages/frontend/src/store/agent-store.ts
import { create } from 'zustand';
import type { Message } from '@pulse-ide/shared';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolName?: string;
  timestamp: number;
}

interface AgentState {
  messages: ChatMessage[];
  sessionId: string;
  isStreaming: boolean;
  currentModel: string;
  provider: string;
  connected: boolean;

  addMessage: (msg: ChatMessage) => void;
  setStreaming: (v: boolean) => void;
  setModel: (model: string, provider: string) => void;
  setConnected: (v: boolean) => void;
  clearMessages: () => void;
  setSessionId: (id: string) => void;
}

export const useAgentStore = create<AgentState>((set) => ({
  messages: [],
  sessionId: 'default',
  isStreaming: false,
  currentModel: 'openrouter/owl-alpha',
  provider: 'openrouter',
  connected: false,

  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
  setStreaming: (v) => set({ isStreaming: v }),
  setModel: (model, provider) => set({ currentModel: model, provider }),
  setConnected: (v) => set({ connected: v }),
  clearMessages: () => set({ messages: [] }),
  setSessionId: (id) => set({ sessionId: id }),
}));
