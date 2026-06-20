"use strict";
// packages/backend/src/server.ts
// WebSocket server — AG-UI protocol event bridge between frontend and backend
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const ws_1 = require("ws");
const http = __importStar(require("http"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const config_js_1 = require("./config.js");
const tool_registry_js_1 = require("./tool-registry.js");
const agent_js_1 = require("./agent.js");
const orchestrator_js_1 = require("./orchestrator.js");
const skills_loader_js_1 = require("./skills-loader.js");
const indexer_js_1 = require("./context/indexer.js");
const compressor_js_1 = require("./context/compressor.js");
const semantic_cache_js_1 = require("./context/cache/semantic-cache.js");
const tracer_js_1 = require("./observability/tracer.js");
// Load .env
function loadEnv() {
    const env = {};
    try {
        const candidates = [path.join(process.cwd(), '.env'), path.join(__dirname, '..', '.env')];
        for (const envPath of candidates) {
            if (!fs.existsSync(envPath))
                continue;
            let content = fs.readFileSync(envPath, 'utf-8');
            if (content.charCodeAt(0) === 0xFEFF)
                content = content.slice(1);
            for (const line of content.split('\n')) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#'))
                    continue;
                const eqIdx = trimmed.indexOf('=');
                if (eqIdx <= 0)
                    continue;
                const key = trimmed.substring(0, eqIdx).trim();
                let val = trimmed.substring(eqIdx + 1).trim();
                if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                    val = val.slice(1, -1);
                }
                if (key) {
                    env[key] = val;
                    process.env[key] = val;
                }
            }
            break;
        }
    }
    catch { /* ignore */ }
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
const sessions = new Map();
function getOrCreateSession(id) {
    if (!sessions.has(id)) {
        sessions.set(id, { id, messages: [], createdAt: Date.now() });
    }
    return sessions.get(id);
}
// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
const envConfig = resolveConfig();
console.log(`[PulseCode] Provider: ${envConfig.provider} | Model: ${envConfig.model}`);
const registry = new tool_registry_js_1.ToolRegistry();
const agent = new agent_js_1.Agent(envConfig.apiKey, envConfig.baseURL, registry, { model: envConfig.model });
const orchestrator = new orchestrator_js_1.Orchestrator();
const skillsLoader = new skills_loader_js_1.SkillsLoader();
const contextEngine = new indexer_js_1.ContextEngine();
const compressor = new compressor_js_1.ContextCompressor();
const cache = new semantic_cache_js_1.SemanticCache();
// Register built-in tools
const file_tools_js_1 = require("./tools/file/file-tools.js");
const terminal_tools_js_1 = require("./tools/terminal/terminal-tools.js");
const web_tools_js_1 = require("./tools/web-tools.js");
const git_tools_js_1 = require("./tools/git-tools.js");
const todo_tool_js_1 = require("./tools/todo-tool.js");
const change_tools_js_1 = require("./tools/change-tools.js");
const allTools = [
    file_tools_js_1.readFileTool, file_tools_js_1.writeFileTool, file_tools_js_1.listFilesTool, file_tools_js_1.editFileTool, file_tools_js_1.searchCodeTool, file_tools_js_1.clearReadCache,
    terminal_tools_js_1.runTerminalTool, terminal_tools_js_1.detectTerminalProfile, terminal_tools_js_1.getShellInfo,
    web_tools_js_1.webSearchTool, web_tools_js_1.webFetchTool,
    git_tools_js_1.gitStatusTool, git_tools_js_1.gitDiffTool, git_tools_js_1.gitLogTool, git_tools_js_1.gitBranchTool, git_tools_js_1.gitCommitTool, git_tools_js_1.gitStashTool,
    todo_tool_js_1.todoTool,
    change_tools_js_1.logChangeTool, change_tools_js_1.getChangeLogTool, change_tools_js_1.revertChangesTool, change_tools_js_1.clearChangeLog,
];
for (const tool of allTools) {
    registry.register(tool);
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
const wss = new ws_1.WebSocketServer({ server: httpServer });
function send(ws, event) {
    if (ws.readyState === ws_1.WebSocket.OPEN) {
        ws.send(JSON.stringify(event));
    }
}
wss.on('connection', (ws) => {
    console.log('[WS] Client connected');
    send(ws, { type: 'modelUpdate', model: envConfig.model, provider: envConfig.provider, baseURL: envConfig.baseURL });
    ws.on('message', async (data) => {
        let event;
        try {
            event = JSON.parse(data.toString());
        }
        catch {
            send(ws, { type: 'error', message: 'Invalid JSON' });
            return;
        }
        const eventType = event.type || event.command;
        try {
            switch (eventType) {
                case 'chat': {
                    const chat = event;
                    const sessionId = chat.sessionId || 'default';
                    const session = getOrCreateSession(sessionId);
                    tracer_js_1.tracer.startTrace(chat.text, 'multi_call', 'openrouter/owl-alpha', sessionId);
                    const result = await agent.chat(chat.text, session.messages, (step) => send(ws, { type: 'toolStep', step: { id: step.id, toolName: step.toolName, status: step.status, result: step.result, duration: step.duration }, requestId: chat.requestId }), (text) => send(ws, { type: 'thinking', text, requestId: chat.requestId }), (text) => send(ws, { type: 'textDelta', text, requestId: chat.requestId }), (text) => send(ws, { type: 'thinkingDelta', text, requestId: chat.requestId }));
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
                    const hist = event;
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
                    const del = event;
                    sessions.delete(del.sessionId);
                    send(ws, { type: 'sessionDeleted', sessionId: del.sessionId });
                    break;
                }
                case 'searchSessions': {
                    const search = event;
                    const results = Array.from(sessions.values())
                        .filter(s => s.messages.some(m => m.content.toLowerCase().includes(search.query.toLowerCase())))
                        .map(s => ({ id: s.id, title: s.messages[0]?.content?.substring(0, 40) || 'Session', updatedAt: s.createdAt }));
                    send(ws, { type: 'sessionSearchResults', results });
                    break;
                }
                case 'switchProvider': {
                    const sw = event;
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
        }
        catch (err) {
            console.error('[WS] Error handling event:', err);
            send(ws, { type: 'error', message: err.message });
        }
    });
    ws.on('close', () => {
        console.log('[WS] Client disconnected');
    });
});
// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
const PORT = config_js_1.config.serverPort;
const HOST = config_js_1.config.serverHost;
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
//# sourceMappingURL=server.js.map