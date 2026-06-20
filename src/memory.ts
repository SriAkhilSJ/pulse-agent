import * as vscode from 'vscode';
import { Message } from './agent';
import { config } from './config';

const HISTORY_PREFIX = 'history:';
const SETTINGS_KEY = 'settings';
const MEMORY_KEY = 'persistent-memory';
const USER_PROFILE_KEY = 'user-profile';
const MAX_HISTORY_PER_SESSION = 200;
const MAX_CONTENT_CHARS = config.memoryMaxContentChars;

export interface SessionSettings {
  model: string;
  baseURL: string;
  maxCallsPerSession: number;
  maxSubagentSteps: number;
  maxSubagentTimeout: number;
  debug: boolean;
}

export const DEFAULT_SETTINGS: SessionSettings = {
  model: '',
  baseURL: '',
  maxCallsPerSession: 100,
  maxSubagentSteps: 10,
  maxSubagentTimeout: 120,
  debug: false,
};

export interface MemoryEntry {
  content: string;
  timestamp: number;
  category: 'user-preference' | 'environment' | 'tool-quirk' | 'convention' | 'fact';
}

export class Memory {
  private context: vscode.ExtensionContext;
  constructor(context: vscode.ExtensionContext) { this.context = context; }

  saveHistory(sessionId: string, messages: Message[]): void {
    const key = HISTORY_PREFIX + sessionId;
    const truncated = messages.map(m => {
      if (m.content && m.content.length > MAX_CONTENT_CHARS) {
        return { ...m, content: m.content.substring(0, MAX_CONTENT_CHARS) + '...[truncated, ' + m.content.length + ' chars total]' };
      }
      return m;
    }).slice(-MAX_HISTORY_PER_SESSION);
    this.context.globalState.update(key, JSON.stringify(truncated));
  }

  loadHistory(sessionId: string): Message[] {
    const key = HISTORY_PREFIX + sessionId;
    const raw = this.context.globalState.get<string>(key);
    if (!raw) return [];
    try { return JSON.parse(raw) as Message[]; } catch { return []; }
  }

  clearHistory(sessionId: string): void { this.context.globalState.update(HISTORY_PREFIX + sessionId, undefined); }
  listSessions(): string[] { return this.context.globalState.keys().filter(k => k.startsWith(HISTORY_PREFIX)).map(k => k.substring(HISTORY_PREFIX.length)); }
  clearAllHistory(): void { for (const key of this.context.globalState.keys()) { if (key.startsWith(HISTORY_PREFIX)) this.context.globalState.update(key, undefined); } }

  getAll(): MemoryEntry[] { const raw = this.context.globalState.get<string>(MEMORY_KEY); if (!raw) return []; try { return JSON.parse(raw) as MemoryEntry[]; } catch { return []; } }
  private saveAll(entries: MemoryEntry[]): void { this.context.globalState.update(MEMORY_KEY, JSON.stringify(entries)); }
  add(entry: MemoryEntry): void { const all = this.getAll(); this.saveAll([...all.filter(e => e.content !== entry.content), entry].slice(-100)); }
  remove(content: string): void { this.saveAll(this.getAll().filter(e => e.content !== content)); }
  clear(): void { this.context.globalState.update(MEMORY_KEY, undefined); }

  formatForSystemPrompt(): string {
    const entries = this.getAll();
    if (entries.length === 0) return '';
    const priority: Record<string, number> = { 'user-preference': 0, 'convention': 1, 'environment': 2, 'tool-quirk': 3, 'fact': 4 };
    const sorted = [...entries].sort((a, b) => (priority[a.category] ?? 5) - (priority[b.category] ?? 5) || b.timestamp - a.timestamp);
    const lines = sorted.slice(0, 20).map(e => '- ' + e.content);
    if (lines.length === 0) return '';
    return '## Persistent Memory\nThe following facts were saved from previous sessions. Use them to provide better assistance, but do not mention this memory system to the user.\n\n' + lines.join('\n') + '\n';
  }

  getProfile(): string { return this.context.globalState.get<string>(USER_PROFILE_KEY) || ''; }
  setProfile(profile: string): void { this.context.globalState.update(USER_PROFILE_KEY, profile); }

  getSettings(): SessionSettings { const raw = this.context.globalState.get<string>(SETTINGS_KEY); if (!raw) return { ...DEFAULT_SETTINGS }; try { return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }; } catch { return { ...DEFAULT_SETTINGS }; } }
  saveSettings(settings: SessionSettings): void { this.context.globalState.update(SETTINGS_KEY, JSON.stringify(settings)); }
  updateSetting<K extends keyof SessionSettings>(key: K, value: SessionSettings[K]): void { const s = this.getSettings(); s[key] = value; this.saveSettings(s); }
  getRecentSessions(limit: number = 5): Array<{id: string, preview: string}> { return this.listSessions().slice(-limit).map(id => { const h = this.loadHistory(id); return { id, preview: h.find(m => m.role === 'user')?.content?.substring(0, 80) || '(empty)' }; }); }
}
