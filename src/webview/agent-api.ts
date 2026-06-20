// src/webview/agent-api.ts
// Bridge between webview and extension for session management

export interface DiffEntry {
  id: string;
  path: string;
  name: string;
  status: 'running' | 'done' | 'error';
  lines: { type: 'add' | 'del' | 'norm'; n?: string; text: string }[];
  result: string;
  duration?: number;
  toolName: string;
}

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

let vscodeApi: ReturnType<typeof acquireVsCodeApi> | null = null;

function getVSCodeApi(): ReturnType<typeof acquireVsCodeApi> {
  // Always create a fresh instance — the VS Code API is tied to the webview lifecycle.
  // Caching a stale reference causes messages to be lost after webview reload.
  if (typeof acquireVsCodeApi !== 'undefined') {
    vscodeApi = acquireVsCodeApi();
  } else {
    vscodeApi = {
      postMessage: (msg: unknown) => console.log('[Mock]', msg),
      getState: () => null,
      setState: () => {},
    };
  }
  return vscodeApi;
}

export interface ToolStep {
  id: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  status: 'running' | 'done' | 'error';
  result?: string;
  /** Relative path to generated image, if any */
  imagePath?: string;
  /** Base64-encoded image data for display in webview */
  imageBase64?: string;
}

export interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

// ─── Ask Mode Types ──────────────────────────────────────────────────

export interface AskUserQuestion {
  question: string;
  motive: string;
  options: string[];
  requestId: string;
  /** If true, allow free-text input alongside options */
  allowCustom?: boolean;
  /** If true, allow selecting multiple options */
  multiple?: boolean;
  /** Internal: dismissed flag */
  _dismissed?: boolean;
}

// ─── Plan Mode Types ─────────────────────────────────────────────────

export interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
}

export interface TodoUpdate {
  todos: TodoItem[];
  sessionId: string;
}

// ─── Permission Types ────────────────────────────────────────────────

export interface PermissionRequest {
  requestId: string;
  toolName: string;
  command?: string;
  patterns: string[];
  sessionId: string;
}

// ─── Session Types ───────────────────────────────────────────────────

export interface SessionInfo {
  id: string;
  title: string;
  preview: string;
  started_at: number;
  message_count?: number;
}

export interface SessionSearchResult {
  session_id: string;
  title: string;
  snippet: string;
  rank: number;
  started_at: number;
}

export type ToolStepHandler = (step: ToolStep) => void;
export type AskUserHandler = (q: AskUserQuestion) => void;
export type PermissionHandler = (r: PermissionRequest) => void;

export class AgentAPI {
  private vscode: ReturnType<typeof acquireVsCodeApi>;
  private listeners: Map<string, Array<(data: unknown) => void>> = new Map();
  private toolStepHandler: ToolStepHandler | null = null;
  private askUserHandler: AskUserHandler | null = null;
  private permissionHandler: PermissionHandler | null = null;
  private pendingHistoryQueue: Array<(h: HistoryMessage[]) => void> = [];
  private pendingSessionsQueue: Array<(s: SessionInfo[]) => void> = [];
  private pendingSearchQueue: Array<(s: SessionSearchResult[]) => void> = [];

  constructor() {
    this.vscode = getVSCodeApi();
    window.addEventListener('message', (event: MessageEvent) => {
      const msg = event.data;
      if (msg.command === 'toolStep' && this.toolStepHandler) {
        this.toolStepHandler(msg.step);
        return;
      }
      if (msg.command === 'loadHistory' && this.pendingHistoryQueue.length > 0) {
        const resolve = this.pendingHistoryQueue.shift()!;
        resolve(msg.history || []);
        return;
      }
      if (msg.command === 'askUser' && this.askUserHandler) {
        this.askUserHandler({
          question: msg.question,
          motive: msg.motive,
          options: msg.options || [],
          requestId: msg.requestId,
          allowCustom: msg.allowCustom !== false,
          multiple: msg.multiple === true,
        });
        return;
      }
      if (msg.command === 'permissionRequest' && this.permissionHandler) {
        this.permissionHandler({
          requestId: msg.requestId,
          toolName: msg.toolName,
          command: msg.command,
          patterns: msg.patterns || [],
          sessionId: msg.sessionId,
        });
        return;
      }
      if (msg.command === 'sessionList' && this.pendingSessionsQueue.length > 0) {
        const resolve = this.pendingSessionsQueue.shift()!;
        resolve(msg.sessions || []);
        return;
      }
      if (msg.command === 'sessionSearchResults' && this.pendingSearchQueue.length > 0) {
        const resolve = this.pendingSearchQueue.shift()!;
        resolve(msg.results || []);
        return;
      }
      const handlers = this.listeners.get(msg.command);
      if (handlers) {
        for (const handler of handlers) handler(msg);
      }
    });
  }

  onToolStep(handler: ToolStepHandler): void { this.toolStepHandler = handler; }
  onAskUser(handler: AskUserHandler): void { this.askUserHandler = handler; }
  onPermissionRequest(handler: PermissionHandler): void { this.permissionHandler = handler; }

  private addListener(command: string, handler: (data: unknown) => void): () => void {
    if (!this.listeners.has(command)) {
      this.listeners.set(command, []);
    }
    this.listeners.get(command)!.push(handler);
    return () => {
      const arr = this.listeners.get(command);
      if (arr) {
        const idx = arr.indexOf(handler);
        if (idx >= 0) arr.splice(idx, 1);
      }
    };
  }

  // --- Chat ---

  requestHistory(): Promise<HistoryMessage[]> {
    return new Promise((resolve) => {
      this.pendingHistoryQueue.push(resolve);
      this.vscode.postMessage({ command: 'getHistory' });
    });
  }

  clearHistory(): void { this.vscode.postMessage({ command: 'clearHistory' }); }
  reload(): void { this.vscode.postMessage({ command: 'reload' }); }

  respondToAsk(question: string, answer: string, requestId: string): void {
    this.vscode.postMessage({ command: 'askUserResponse', question, answer, requestId });
  }

  rejectAsk(requestId: string): void {
    this.vscode.postMessage({ command: 'askUserReject', requestId });
  }

  respondToPermission(requestId: string, decision: 'once' | 'always' | 'deny'): void {
    this.vscode.postMessage({ command: 'permissionResponse', requestId, decision });
  }

  async chat(text: string, sessionId?: string, isNewSession?: boolean): Promise<string> {
    return new Promise((resolve, reject) => {
      const id = Date.now().toString() + '_' + Math.random().toString(36).substring(2, 8);
      const unsub = this.addListener('response', (data: unknown) => {
        const resp = data as { requestId: string; text: string; error?: string };
        if (resp.requestId === id) {
          unsub();
          if (resp.error) reject(new Error(resp.error));
          else resolve(resp.text);
        }
      });
      this.vscode.postMessage({ command: 'chat', requestId: id, text, sessionId, isNewSession });
    });
  }

  // --- Session Management ---

  requestSessions(): Promise<SessionInfo[]> {
    return new Promise((resolve) => {
      this.pendingSessionsQueue.push(resolve);
      this.vscode.postMessage({ command: 'getSessions' });
    });
  }

  searchSessions(query: string): Promise<SessionSearchResult[]> {
    return new Promise((resolve) => {
      this.pendingSearchQueue.push(resolve);
      this.vscode.postMessage({ command: 'searchSessions', query });
    });
  }

  resumeSession(sessionId: string): void {
    this.vscode.postMessage({ command: 'resumeSession', sessionId });
  }

  deleteSession(sessionId: string): void {
    this.vscode.postMessage({ command: 'deleteSession', sessionId });
  }

  newSession(previousSessionId?: string): void {
    this.vscode.postMessage({ command: 'newSession', previousSessionId });
  }

  listSubAgents(): void {
    this.vscode.postMessage({ command: 'listSubagents' });
  }

  stop(): void {
    this.vscode.postMessage({ command: 'stop' });
  }

  async getAudit(): Promise<any[]> {
    return new Promise((resolve) => {
      const id = Date.now().toString() + '_' + Math.random().toString(36).substring(2, 8);
      const unsub = this.addListener('auditResponse', (data: unknown) => {
        const resp = data as { requestId: string; entries: any[] };
        if (resp.requestId === id) { unsub(); resolve(resp.entries); }
      });
      this.vscode.postMessage({ command: 'getAudit', requestId: id });
    });
  }

  async getFileVersions(path: string): Promise<string> {
    return new Promise((resolve) => {
      const id = Date.now().toString() + '_' + Math.random().toString(36).substring(2, 8);
      const unsub = this.addListener('versionsResponse', (data: unknown) => {
        const resp = data as { requestId: string; result: string };
        if (resp.requestId === id) { unsub(); resolve(resp.result); }
      });
      this.vscode.postMessage({ command: 'getFileVersions', requestId: id, path });
    });
  }

  async rollbackFile(path: string): Promise<string> {
    return new Promise((resolve) => {
      const id = Date.now().toString() + '_' + Math.random().toString(36).substring(2, 8);
      const unsub = this.addListener('rollbackResponse', (data: unknown) => {
        const resp = data as { requestId: string; result: string };
        if (resp.requestId === id) { unsub(); resolve(resp.result); }
      });
      this.vscode.postMessage({ command: 'rollbackFile', requestId: id, path });
    });
  }

  /** Open a file in the VS Code editor */
  openFileInEditor(path: string): void {
    this.vscode.postMessage({ command: 'openFile', path });
  }

  /** Generic postMessage passthrough for webview -> extension commands */
  postMessage(msg: Record<string, unknown>): void {
    this.vscode.postMessage(msg);
  }

  /** Notify extension about diff changes for agent context */
  notifyDiffChanges(entries: DiffEntry[]): void {
    this.vscode.postMessage({ command: 'diffChanges', entries: entries.map(e => ({ path: e.path, name: e.name, addCount: e.lines.filter(l => l.type === 'add').length, delCount: e.lines.filter(l => l.type === 'del').length, lines: e.lines })) });
  }
}
