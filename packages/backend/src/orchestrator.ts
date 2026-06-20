// packages/backend/src/orchestrator.ts
// Single-to-Multi-Agent Orchestrator

import type { Agent, Message, ShellInfo } from './agent.js';
import type { ToolRegistry } from './tool-registry.js';
import type { AgentType, AgentTypeInfo, SubAgentConfig, OrchestratorState } from '@pulse-ide/shared';
import { config } from './config.js';

export type { AgentType, AgentTypeInfo, SubAgentConfig, OrchestratorState };

export const AGENT_TYPES: Record<AgentType, AgentTypeInfo> = {
  plan: { type: 'plan', label: 'Planner', icon: 'PLAN', color: '#b794f6', systemPrompt: 'You are a Plan Agent. Create detailed step-by-step plans. Read the codebase first. Output numbered steps with agent type assignments. DO NOT execute anything.', defaultTools: ['read_file', 'list_files', 'get_current_file', 'search_code', 'run_terminal'] },
  code: { type: 'code', label: 'Coder', icon: 'CODE', color: '#75beff', systemPrompt: 'You are a Code Agent. Write clean code. Use read_file, write_file, run_terminal. Always verify. Create real files with complete content.', defaultTools: ['read_file', 'write_file', 'edit_file', 'delete_file', 'list_files', 'get_current_file', 'search_code', 'run_terminal'] },
  browser: { type: 'browser', label: 'Browser', icon: 'BROWSER', color: '#89d185', systemPrompt: 'You are a Browser Agent. Use run_terminal + playwright for browser automation. Navigate, click, type, screenshot take after EVERY action. Report what you see.', defaultTools: ['run_terminal', 'read_file', 'write_file', 'see_image', 'browser_navigate', 'browser_click', 'browser_type', 'browser_screenshot', 'browser_assert_text', 'browser_get_text'] },
  desktop: { type: 'desktop', label: 'Desktop', icon: 'DESKTOP', color: '#cca700', systemPrompt: 'You are a Desktop Agent. Use run_terminal for system commands. Full system access via bash. Manage files, run programs, install packages.', defaultTools: ['run_terminal', 'read_file', 'write_file', 'edit_file', 'delete_file', 'list_files', 'search_code'] },
  ask: { type: 'ask', label: 'Asker', icon: 'ASK', color: '#f14c4c', systemPrompt: 'You are an Ask Agent. Formulate clear questions for the user. State the goal, the ambiguity, and options. Wait for response.', defaultTools: [] },
  android: { type: 'android', label: 'Android', icon: 'ANDROID', color: '#4ec9b0', systemPrompt: 'You are an Android Agent. Use ADB via run_terminal (adb devices, adb shell, adb install). Screenshots, tap, type. Verify device connection first.', defaultTools: ['run_terminal', 'read_file', 'write_file', 'android_devices', 'android_click', 'android_type', 'android_swipe', 'android_screenshot'] },
  audio: { type: 'audio', label: 'Audio', icon: 'AUDIO', color: '#c586c0', systemPrompt: 'You are an Audio Agent. Use run_terminal for audio ops (ffplay, aplay, whisper). Record, play, transcribe.', defaultTools: ['run_terminal', 'read_file', 'write_file', 'audio_record', 'audio_play', 'audio_transcribe'] },
};

export class Orchestrator {
  private state: OrchestratorState = {
    mode: 'single',
    phase: 'idle',
    task: '',
    plan: '',
    subagents: [],
    currentStep: 0,
    totalSteps: 0,
  };

  getState(): OrchestratorState {
    return { ...this.state };
  }

  setTask(task: string): void {
    this.state.task = task;
    this.state.phase = 'idle';
  }

  setPlan(plan: string): void {
    this.state.plan = plan;
  }

  setPhase(phase: OrchestratorState['phase']): void {
    this.state.phase = phase;
  }

  addSubagent(config: SubAgentConfig): void {
    this.state.subagents.push(config);
  }

  updateSubagent(id: string, updates: Partial<SubAgentConfig>): void {
    const sa = this.state.subagents.find(s => s.id === id);
    if (sa) Object.assign(sa, updates);
  }
}
