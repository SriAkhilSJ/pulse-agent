// src/session-db.ts
// Hermes-style SQLite session storage with FTS5 full-text search.
// Stores session transcripts, enables cross-session recall and search.

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

// Simple sqlite3 wrapper using VS Code's built-in sqlite if available,
// otherwise we use a JSON-based fallback stored in globalState.
// For production, use better-sqlite3 or the sqlite3 npm package.

const SCHEMA_VERSION = 1;
let globalMessageIdCounter = 0;
const MESSAGE_ID_COUNTER_KEY = 'messageIdCounter';

interface SessionRow {
  id: string;
  source: string;
  title: string;
  parent_session_id: string | null;
  started_at: number;
  ended_at: number | null;
  message_count: number;
  active: number; // 1 = active, 0 = archived
}

interface MessageRow {
  id: number;
  session_id: string;
  role: string;
  content: string;
  tool_name: string | null;
  tool_calls: string | null;
  timestamp: number;
  active: number;
}

interface SearchResult {
  session_id: string;
  title: string;
  snippet: string;
  rank: number;
  started_at: number;
}

/**
 * Session storage backed by VS Code globalState (JSON fallback).
 * For full SQLite+FTS5, install better-sqlite3.
 * This implementation provides the same API but uses JSON files
 * stored in the extension's global storage directory.
 */
export class SessionDB {
  private readonly dbDir: string;
  private readonly sessionsFile: string;
  private readonly messagesFile: string;
  private readonly context: vscode.ExtensionContext;
  private cache: {
    sessions: SessionRow[];
    messages: MessageRow[];
    dirty: boolean;
  } | null = null;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    // Use the extension's global storage path for persistence
    this.dbDir = context.globalStorageUri
      ? context.globalStorageUri.fsPath
      : path.join(
          process.env.HOME || process.env.USERPROFILE || '/tmp',
          '.pulsecode',
          'sessions',
        );
    this.sessionsFile = path.join(this.dbDir, 'sessions.json');
    this.messagesFile = path.join(this.dbDir, 'messages.json');

    // Ensure directory exists
    if (!fs.existsSync(this.dbDir)) {
      fs.mkdirSync(this.dbDir, { recursive: true });
    }

    // Load persisted message ID counter — also scan existing messages to avoid ID collisions
    const savedCounter = context.globalState.get<number>(MESSAGE_ID_COUNTER_KEY, 0);
    if (savedCounter > 0) {
      globalMessageIdCounter = savedCounter;
    }
    // If we have existing messages in the JSON file, ensure counter is above max existing ID
    try {
      if (fs.existsSync(this.messagesFile)) {
        const existing: MessageRow[] = JSON.parse(fs.readFileSync(this.messagesFile, 'utf-8'));
        if (existing.length > 0) {
          const maxId = Math.max(...existing.map(m => m.id));
          if (maxId >= globalMessageIdCounter) {
            globalMessageIdCounter = maxId;
          }
        }
      }
    } catch { /* ignore */ }
  }

  // ── Lazy load cache ──────────────────────────────────────────────────

  private load(): void {
    if (this.cache) return;
    try {
      this.cache = {
        sessions: this.sessionsFile && fs.existsSync(this.sessionsFile)
          ? JSON.parse(fs.readFileSync(this.sessionsFile, 'utf-8'))
          : [],
        messages: this.messagesFile && fs.existsSync(this.messagesFile)
          ? JSON.parse(fs.readFileSync(this.messagesFile, 'utf-8'))
          : [],
        dirty: false,
      };
    } catch {
      this.cache = { sessions: [], messages: [], dirty: false };
    }
  }

  private save(): void {
    if (!this.cache?.dirty) return;
    try {
      fs.writeFileSync(
        this.sessionsFile,
        JSON.stringify(this.cache.sessions, null, 2),
      );
      // Only save last 5000 messages to keep file manageable
      const msgs = this.cache.messages.slice(-5000);
      fs.writeFileSync(this.messagesFile, JSON.stringify(msgs, null, 2));
      this.cache.dirty = false;
    } catch (err) {
      console.error('[SessionDB] Save failed:', err);
    }
  }

  // ── Session CRUD ─────────────────────────────────────────────────────

  createSession(
    id: string,
    source: string = 'default',
    title?: string | null,
    parentSessionId?: string | null,
  ): SessionRow {
    this.load();
    const session: SessionRow = {
      id,
      source,
      title: title || `Session ${id.substring(0, 8)}`,
      parent_session_id: parentSessionId || null,
      started_at: Date.now(),
      ended_at: null,
      message_count: 0,
      active: 1,
    };
    this.cache!.sessions.push(session);
    this.cache!.dirty = true;
    this.save();
    return session;
  }

  getSession(id: string): SessionRow | null {
    this.load();
    return this.cache!.sessions.find((s) => s.id === id) || null;
  }

  endSession(id: string): void {
    this.load();
    const session = this.cache!.sessions.find((s) => s.id === id);
    if (session) {
      session.ended_at = Date.now();
      this.cache!.dirty = true;
      this.save();
    }
  }

  updateTitle(id: string, title: string): void {
    this.load();
    const session = this.cache!.sessions.find((s) => s.id === id);
    if (session) {
      session.title = title;
      this.cache!.dirty = true;
      this.save();
    }
  }

  updateMessageCount(id: string): void {
    this.load();
    const session = this.cache!.sessions.find((s) => s.id === id);
    if (session) {
      session.message_count = this.cache!.messages.filter(
        (m) => m.session_id === id,
      ).length;
      this.cache!.dirty = true;
      this.save();
    }
  }

  listSessions(
    source?: string,
    limit: number = 20,
  ): SessionRow[] {
    this.load();
    let sessions = this.cache!.sessions.filter((s) => s.active === 1);
    if (source) {
      sessions = sessions.filter((s) => s.source === source);
    }
    return sessions
      .sort((a, b) => b.started_at - a.started_at)
      .slice(0, limit);
  }

  getRecentSessions(limit: number = 5): Array<{
    id: string;
    title: string;
    preview: string;
    started_at: number;
  }> {
    this.load();
    const sessions = this.listSessions(undefined, limit);
    return sessions.map((s) => {
      const firstUser = this.cache!.messages.find(
        (m) => m.session_id === s.id && m.role === 'user',
      );
      return {
        id: s.id,
        title: s.title,
        preview: firstUser?.content?.substring(0, 80) || '(empty)',
        started_at: s.started_at,
      };
    });
  }

  // ── Message CRUD ─────────────────────────────────────────────────────

  addMessage(
    sessionId: string,
    role: string,
    content: string,
    toolName?: string | null,
    toolCalls?: string | null,
  ): MessageRow {
    this.load();
    const msg: MessageRow = {
      id: ++globalMessageIdCounter,
      session_id: sessionId,
      role,
      content,
      tool_name: toolName || null,
      tool_calls: toolCalls || null,
      timestamp: Date.now(),
      active: 1,
    };
    this.cache!.messages.push(msg);
    this.updateMessageCount(sessionId);
    this.save();
    // Persist message ID counter to survive extension restarts
    this.context.globalState.update(MESSAGE_ID_COUNTER_KEY, globalMessageIdCounter);
    return msg;
  }

  getSessionMessages(sessionId: string): MessageRow[] {
    this.load();
    return this.cache!.messages
      .filter((m) => m.session_id === sessionId && m.active === 1)
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  getSessionTranscript(sessionId: string): string {
    const messages = this.getSessionMessages(sessionId);
    return messages
      .map((m) => `[${m.role.toUpperCase()}]: ${m.content}`)
      .join('\n---\n');
  }

  // ── Search ──────────────────────────────────────────────────────────
  // Simple keyword search across all messages (FTS5 equivalent for JSON backend)

  searchSessions(query: string, limit: number = 5): SearchResult[] {
    this.load();
    if (!query.trim()) return [];

    const keywords = query
      .toLowerCase()
      .split(/\s+/)
      .filter((k) => k.length > 2);

    // Score sessions by keyword matches
    const scores = new Map<string, number>();
    const snippets = new Map<string, string>();

    for (const msg of this.cache!.messages) {
      const content = (msg.content || '').toLowerCase();
      let score = 0;
      for (const kw of keywords) {
        if (content.includes(kw)) {
          score += 1;
          // Bonus for exact phrase match
          if (content.includes(query.toLowerCase())) {
            score += 5;
          }
        }
      }
      if (score > 0) {
        const prev = scores.get(msg.session_id) || 0;
        scores.set(msg.session_id, prev + score);
        if (!snippets.has(msg.session_id)) {
          snippets.set(
            msg.session_id,
            msg.content.substring(0, 200),
          );
        }
      }
    }

    // Build results
    const results: SearchResult[] = [];
    for (const [sessionId, score] of scores.entries()) {
      const session = this.cache!.sessions.find((s) => s.id === sessionId);
      if (session) {
        results.push({
          session_id: sessionId,
          title: session.title,
          snippet: snippets.get(sessionId) || '',
          rank: score,
          started_at: session.started_at,
        });
      }
    }

    return results.sort((a, b) => b.rank - a.rank).slice(0, limit);
  }

  scrollSession(
    sessionId: string,
    limit: number = 10,
    offset: number = 0,
  ): MessageRow[] {
    const messages = this.getSessionMessages(sessionId);
    return messages.slice(offset, offset + limit);
  }

  // ── Cleanup ──────────────────────────────────────────────────────────

  clearSession(sessionId: string): void {
    this.load();
    this.cache!.messages = this.cache!.messages.filter(
      (m) => m.session_id !== sessionId,
    );
    this.cache!.sessions = this.cache!.sessions.filter(
      (s) => s.id !== sessionId,
    );
    this.cache!.dirty = true;
    this.save();
  }

  clearAll(): void {
    this.cache = { sessions: [], messages: [], dirty: true };
    this.save();
  }

  getStats(): { sessions: number; messages: number; fileSizeKB: number } {
    this.load();
    let fileSizeKB = 0;
    try {
      if (fs.existsSync(this.messagesFile)) {
        fileSizeKB = Math.round(
          fs.statSync(this.messagesFile).size / 1024,
        );
      }
    } catch { /* ignore */ }
    return {
      sessions: this.cache!.sessions.length,
      messages: this.cache!.messages.length,
      fileSizeKB,
    };
  }
}
