// packages/backend/src/server.ts
// WebSocket server — AG-UI protocol event bridge between frontend and backend

import { WebSocketServer, WebSocket } from 'ws';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { config } from './config.js';
import { ToolRegistry } from './tool-registry.js';
import { Agent } from './agent.js';
import { Orchestrator } from './orchestrator.js';
import { SkillsLoader } from './skills-loader.js';
import { ContextEngine } from './context/indexer.js';
import { ContextCompressor } from './context/compressor.js';
import { SemanticCache } from './context/cache/semantic-cache.js';
import { tracer } from './observability/tracer.js';
import type {
  IncomingEvent, OutgoingEvent,
  ChatEvent, StopEvent, GetHistoryEvent, GetSessionsEvent,
  SearchSessionsEvent, ResumeSessionEvent, DeleteSessionEvent,
  NewSessionEvent, AskUserResponseEvent, PermissionResponseEvent,
  SwitchProviderEvent,
} from '@pulse-ide/shared';

// Load .env
function loadEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  try {
    const candidates = [path.join(process.cwd(), '.env'), path.join(__dirname, '..', '.env')];
    for (const envPath of candidates) {
      if (!fs.existsSync(envPath)) continue;
      let content = fs.readFileSync(envPath, 'utf-8');
      if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx <= 0) continue;
        const key = trimmed.substring(0, eqIdx).trim();
        let val = trimmed.substring(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (key) { env[key] = val; process.env[key] = val; }
      }
      break;
    }
  } catch { /* ignore */ }
  return env;
}

// Resolve config from env
function resolveConfig() {
  loadEnv();
  const provider = (process.env['PROVIDER'] || 'openrouter').toLowerCase();
  const prefix = provider.toUpperCase();
  return {
    model: process.env[prefix + '_MODEL'] || process.env['CUSTOM_MODEL'] || 'openrouter/owl-alpha',
    baseURL: process.env[prefix + '_URL'] || process.env['CUSTOM_URL'] || 'https://openrouter.ai/api/v1',
    apiKey: process.env[prefix + '_API_KEY'] || process.env['CUSTOM_API_KEY'] || process.env['API_KEY'] || '',
    provider,
  };
}

// Session store (in-memory for now, upgrade to SQLite)
interface SessionData {
  id: string;
  messages: Array<{ role: string; content: string }>;
  createdAt: number;
}
const sessions = new Map<string, SessionData>();

function getOrCreateSession(id: string): SessionData {
  if (!sessions.has(id)) {
    sessions.set(id, { id, messages: [], createdAt: Date.now() });
  }
  return sessions.get(id)!;
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

const envConfig = resolveConfig();
console.log(`[PulseCode] Provider: ${envConfig.provider} | Model: ${envConfig.model}`);

const registry = new ToolRegistry();
const agent = new Agent(envConfig.apiKey, envConfig.baseURL, registry, { model: envConfig.model });
const orchestrator = new Orchestrator();
const skillsLoader = new SkillsLoader();
const contextEngine = new ContextEngine();
const compressor = new ContextCompressor();
const cache = new SemanticCache();

// Register built-in tools
import {
  readFileTool, writeFileTool, listFilesTool, editFileTool, searchCodeTool, clearReadCache,
} from './tools/file/file-tools.js';
import { runTerminalTool, detectTerminalProfile, getShellInfo } from './tools/terminal/terminal-tools.js';
import { webSearchTool, webFetchTool } from './tools/web-tools.js';
import { gitStatusTool, gitDiffTool, gitLogTool, gitBranchTool, gitCommitTool, gitStashTool } from './tools/git-tools.js';
import { todoTool } from './tools/todo-tool.js';
import { logChangeTool, getChangeLogTool, revertChangesTool, clearChangeLog } from './tools/change-tools.js';

const allTools = [
  readFileTool, writeFileTool, listFilesTool, editFileTool, searchCodeTool, clearReadCache,
  runTerminalTool, detectTerminalProfile, getShellInfo,
  webSearchTool, webFetchTool,
  gitStatusTool, gitDiffTool, gitLogTool, gitBranchTool, gitCommitTool, gitStashTool,
  todoTool,
  logChangeTool, getChangeLogTool, revertChangesTool, clearChangeLog,
];
for (const tool of allTools) {
  registry.register(tool as any);
}

console.log(`[PulseCode] ${registry.getToolNames().length} tools registered`);
console.log(`[PulseCode] ${skillsLoader.getAllSkills().length} skills loaded`);

// Context builder
agent.setContextBuilder(() => {
  return contextEngine.getCurrentContext();
});

// ---------------------------------------------------------------------------
// WebSocket server
// ---------------------------------------------------------------------------

const httpServer = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok', tools: registry.getToolNames().length }));
});

const wss = new WebSocketServer({ server: httpServer });

function send(ws: WebSocket, event: OutgoingEvent) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(event));
  }
}

wss.on('connection', (ws) => {
  console.log('[WS] Client connected');

  send(ws, { type: 'modelUpdate', model: envConfig.model, provider: envConfig.provider, baseURL: envConfig.baseURL });

  ws.on('message', async (data) => {
    let event: IncomingEvent;
    try {
      event = JSON.parse(data.toString());
    } catch {
      send(ws, { type: 'error', message: 'Invalid JSON' });
      return;
    }

    const eventType = (event as any).type || (event as any).command;

    try {
      switch (eventType) {
        case 'chat': {
          const chat = event as ChatEvent;
          const sessionId = chat.sessionId || 'default';
          const session = getOrCreateSession(sessionId);

          tracer.startTrace(chat.text, 'multi_call', 'openrouter/owl-alpha', sessionId);

          const result = await agent.chat(
            chat.text,
            session.messages as any,
            (step) => send(ws, { type: 'toolStep', step: { id: step.id, toolName: step.toolName, status: step.status, result: step.result, duration: step.duration }, requestId: chat.requestId }),
            (text) => send(ws, { type: 'thinking', text, requestId: chat.requestId }),
            (text) => send(ws, { type: 'textDelta', text, requestId: chat.requestId }),
            (text) => send(ws, { type: 'thinkingDelta', text, requestId: chat.requestId }),
          );

          session.messages.push({ role: 'user', content: chat.text });
          session.messages.push({ role: 'assistant', content: result.response });

          send(ws, { type: 'response', requestId: chat.requestId, text: result.response });
          break;
        }

        case 'stop': {
          // Abort handled via agent's abort signal
          send(ws, { type: 'stopped' });
          break;
        }

        case 'getSessions': {
          const list = Array.from(sessions.values()).map(s => ({
            id: s.id,
            title: s.messages[0]?.content?.substring(0, 40) || 'New Session',
            updatedAt: s.createdAt,
          }));
          send(ws, { type: 'sessionList', sessions: list });
          break;
        }

        case 'getHistory': {
          const hist = event as GetHistoryEvent;
          const session = sessions.get(hist.sessionId);
          send(ws, { type: 'loadHistory', history: session?.messages || [], sessionId: hist.sessionId });
          break;
        }

        case 'newSession': {
          const id = `session-${Date.now()}`;
          sessions.set(id, { id, messages: [], createdAt: Date.now() });
          send(ws, { type: 'newSessionStarted' });
          break;
        }

        case 'deleteSession': {
          const del = event as DeleteSessionEvent;
          sessions.delete(del.sessionId);
          send(ws, { type: 'sessionDeleted', sessionId: del.sessionId });
          break;
        }

        case 'searchSessions': {
          const search = event as SearchSessionsEvent;
          const results = Array.from(sessions.values())
            .filter(s => s.messages.some(m => m.content.toLowerCase().includes(search.query.toLowerCase())))
            .map(s => ({ id: s.id, title: s.messages[0]?.content?.substring(0, 40) || 'Session', updatedAt: s.createdAt }));
          send(ws, { type: 'sessionSearchResults', results });
          break;
        }

        case 'switchProvider': {
          const sw = event as SwitchProviderEvent;
          process.env['PROVIDER'] = sw.provider;
          const newCfg = resolveConfig();
          agent.setModel(newCfg.model);
          agent.setBaseURL(newCfg.baseURL);
          agent.setApiKey(newCfg.apiKey);
          send(ws, { type: 'modelUpdate', model: newCfg.model, provider: sw.provider, baseURL: newCfg.baseURL });
          break;
        }

        default:
          send(ws, { type: 'error', message: `Unknown event type: ${eventType}` });
      }
    } catch (err) {
      console.error('[WS] Error handling event:', err);
      send(ws, { type: 'error', message: (err as Error).message });
    }
  });

  ws.on('close', () => {
    console.log('[WS] Client disconnected');
  });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const PORT = config.serverPort;
const HOST = config.serverHost;

httpServer.listen(PORT, HOST, () => {
  console.log(`[PulseCode] Server running on ws://${HOST}:${PORT}`);
  console.log(`[PulseCode] Health check: http://${HOST}:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[PulseCode] Shutting down...');
  wss.close();
  httpServer.close();
  process.exit(0);
});
