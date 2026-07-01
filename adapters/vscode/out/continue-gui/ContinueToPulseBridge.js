"use strict";
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
exports.ContinueToPulseBridge = void 0;
/**
 * ContinueToPulseBridge — translates all UI messages to Pulse backend calls.
 * Supports every card/feature in the custom Pulse chat webview.
 */
const vscode = __importStar(require("vscode"));
const cp = __importStar(require("child_process"));
const fs = __importStar(require("fs"));
const PYTHON_EXE = 'C:\\Users\\Administrator\\AppData\\Local\\Programs\\Python\\Python311\\python.exe';
const AGENTS_DIR = "D:\\pulse\\python\\agents";
class ContinueToPulseBridge {
    webview;
    agentProcess = null;
    listener = null;
    constructor(webview) {
        this.webview = webview;
        this.listener = webview.onDidReceiveMessage((msg) => this.handleMessage(msg));
    }
    dispose() { this.listener?.dispose(); this.killAgent(); }
    async handleMessage(msg) {
        const { messageType, messageId, data } = msg;
        try {
            if (typeof data !== 'undefined')
                console.log("[Pulse Bridge] REQUEST:", messageType, JSON.stringify(data).substring(0, 200));
            else
                console.log("[Pulse Bridge] REQUEST:", messageType, "(no data)");
            const result = await this.route(messageType, data);
            console.log("[Pulse Bridge] RESPONSE:", messageType, JSON.stringify(result).substring(0, 200));
            this.respond(messageType, messageId, { done: true, content: result, status: "success" });
        }
        catch (err) {
            console.log("[Pulse Bridge] ERROR:", messageType, err.message);
            this.respond(messageType, messageId, { done: true, error: err.message, status: "error" });
        }
    }
    respond(messageType, messageId, data) {
        this.webview.postMessage({ messageType, messageId, data });
    }
    webviewSend(messageType, data) {
        this.webview.postMessage({ messageType, messageId: crypto.randomUUID(), data });
    }
    // ─── Router ────────────────────────────────────────────
    async route(messageType, data) {
        switch (messageType) {
            // Core
            case "ping": return "pong";
            case "abort":
                this.killAgent();
                return { aborted: true };
            case "chatMessage":
                this.handleChatMessage(data);
                return { queued: true };
            // Config (from UI settings)
            case "config/setModel":
                await vscode.workspace.getConfiguration("pulse").update("model", data?.model, vscode.ConfigurationTarget.Global);
                return { done: true };
            case "config/setApiKey":
                await vscode.workspace.getConfiguration("pulse").update("apiKey", data?.apiKey, vscode.ConfigurationTarget.Global);
                return { done: true };
            // Sessions
            case "session/list": return this.listSessions();
            case "session/load":
                return { config: null, sessions: [] };
            // Continue compat routes
            case "config/getSerializedConfig": return this.getConfigResult();
            case "config/getSerializedProfileInfo": return this.getSerializedProfileInfo(data);
            case "config/listProfiles": return [{ id: "default", title: "Pulse Default" }];
            case "config/reload": return this.getConfigPayload();
            case "config/addOpenAiKey":
            case "config/addModel":
            case "config/deleteModel": return { done: true };
            case "llm/streamChat": return this.streamChat(data);
            case "chatDescriber/describe": return { title: "Code task" };
            case "history/list": return [];
            case "history/load": return [];
            case "history/save":
            case "history/delete":
            case "history/clear": return { done: true };
            case "tools/list": return this.listTools();
            case "tools/call": return this.callTool(data);
            case "getOpenFiles": return this.getOpenFiles();
            case "getWorkspaceDirs": return (vscode.workspace.workspaceFolders || []).map(f => f.uri.fsPath);
            case "fileExists": return this.fileExists(data);
            case "readFile": return this.readFile(data);
            case "writeFile": return this.writeFile(data.filepath, data.content);
            case "readRangeInFile": return this.readRangeInFile(data.filepath, data.range);
            case "runCommand": return this.runCommand(data.command);
            case "searchFiles": return this.searchFiles(data.query || "");
            case "listDir": return this.listDir(data);
            case "showMessage":
                this.showMessage(data);
                return { done: true };
            case "showToast":
                this.showMessage(data);
                return { done: true };
            case "setFileDiagnostics": return { done: true };
            case "docs/initStatuses": return [];
            case "onboarding/complete": return { done: true };
            default:
                console.log("[Pulse Bridge] unhandled:", messageType);
                return {};
        }
    }
    // ─── Chat Message (UI → backend → streaming UI updates) ───
    async handleChatMessage(data) {
        const { text, sessionId, mode } = data || {};
        if (!text)
            return;
        const isCodeRequest = text.length > 50 || /generate|create|write|implement|code|function|class/i.test(text);
        const config = vscode.workspace.getConfiguration("pulse");
        const modelName = config.get("model") || "openrouter/free";
        this.webviewSend("toolCall", { name: "analyze", arguments: { task: text.substring(0, 100) }, status: "running" });
        if (mode === "agent" || (mode !== "chat" && isCodeRequest)) {
            // Run agent loop with streaming tool events
            await this.runPipelineStreaming(text, sessionId);
        }
        else {
            // Direct LLM call
            const result = await this.directLLM([{ role: "user", content: text }]);
            this.webviewSend("toolResult", { name: "analyze", status: "success", duration: 0, result: "Complete" });
            this.webviewSend("chatResponse", result);
        }
    }
    async runPipelineStreaming(task, sessionId) {
        const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "";
        return new Promise((resolve) => {
            const proc = cp.spawn(PYTHON_EXE, [
                "pipeline.py", "--task", task, "--context", ws, "--platform", "ide"
            ], { cwd: AGENTS_DIR, stdio: ["pipe", "pipe", "pipe"] });
            let output = "";
            proc.stdout.on("data", (d) => { output += d.toString(); });
            proc.stderr.on("data", (d) => {
                const lines = d.toString().trim().split("\n");
                for (const line of lines) {
                    if (!line.trim())
                        continue;
                    try {
                        const event = JSON.parse(line);
                        if (event.type === "tool_start") {
                            this.webviewSend("toolCall", { name: event.name, arguments: event, status: "running" });
                        }
                        else if (event.type === "tool_result") {
                            this.webviewSend("toolResult", { name: event.name, status: "success", duration: event.duration || 0, result: event.result });
                        }
                        else if (event.type === "tool_approval") {
                            this.webviewSend("toolApprovalRequest", { name: event.name, arguments: event });
                        }
                    }
                    catch {
                        console.log("[Pulse Pipeline STDERR]", line);
                    }
                }
            });
            proc.on("error", (err) => {
                this.webviewSend("chatError", { error: err.message });
                resolve();
            });
            proc.on("exit", (code) => {
                let content = output || "(no output)";
                try {
                    const parsed = JSON.parse(output);
                    content = parsed.response ||
                        (parsed.code_changes
                            ? `Generated ${parsed.code_changes.length} files:\n` +
                                parsed.code_changes.map((c) => `  • ${c.file_path}`).join("\n")
                            : JSON.stringify(parsed, null, 2));
                }
                catch { /* plain text */ }
                this.webviewSend("chatResponse", { role: "assistant", content });
                resolve();
            });
        });
    }
    // ─── Sessions ──────────────────────────────────
    async listSessions() {
        try {
            const dbPath = "D:\\pulse\\python\\agents\\session_db.py";
            if (fs.existsSync(dbPath)) {
                const proc = cp.spawnSync(PYTHON_EXE, ["-c", `
import sys; sys.path.insert(0, r"D:\\pulse\\python\\agents")
from session_db import SessionDB
db = SessionDB()
sessions = db.list_sessions()
import json; print(json.dumps([{"id": s.id, "title": s.title, "updated_at": s.updated_at} for s in sessions]))
`], { cwd: AGENTS_DIR, timeout: 5000 });
                if (proc.status === 0) {
                    return JSON.parse(proc.stdout.toString().trim());
                }
            }
        }
        catch { /* ignore */ }
        return [];
    }
    // ─── Config ─────────────────────────────────────
    getSerializedConfig() {
        const config = vscode.workspace.getConfiguration("pulse");
        const apiKey = this.getApiKey();
        return {
            models: [{
                    title: "Pulse Agent (auto)",
                    provider: "openai",
                    model: config.get("model") || "openrouter/free",
                    apiKey,
                    apiBase: config.get("baseURL") || "https://openrouter.ai/api/v1",
                    contextLength: 128000,
                }],
            contextProviders: [],
            slashCommands: [
                { name: "code", description: "Generate code" },
                { name: "explain", description: "Explain code" },
                { name: "test", description: "Generate tests" },
                { name: "refactor", description: "Refactor code" },
            ],
            selectedModelByRole: {
                chat: { model: config.get("model") || "openrouter/free", provider: "openai", title: "Pulse Agent (auto)" },
            },
        };
    }
    getSerializedProfileInfo(data) {
        return { id: data?.profileId || "default", title: "Pulse Default", config: this.getSerializedConfig() };
    }
    getConfigResult() {
        return { config: this.getSerializedConfig(), configLoadInterrupted: false, errors: [] };
    }
    getConfigPayload() {
        return { result: this.getConfigResult(), profileId: "default", profiles: [{ id: "default", title: "Pulse Default" }] };
    }
    // ─── LLM Chat ───────────────────────────────────
    async streamChat(params) {
        const { messages, model } = params;
        const lastMsg = messages?.[messages.length - 1]?.content || "";
        const isCodeRequest = lastMsg.length > 50 || /generate|create|write|implement|code|function|class/i.test(lastMsg);
        return isCodeRequest ? this.runPulsePipeline(lastMsg) : this.directLLM(messages, model);
    }
    async runPulsePipeline(task) {
        const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "";
        return new Promise((resolve, reject) => {
            const proc = cp.spawn(PYTHON_EXE, [
                "pipeline.py", "--task", task, "--context", ws, "--platform", "ide"
            ], { cwd: AGENTS_DIR, stdio: ["pipe", "pipe", "pipe"] });
            let output = "";
            proc.stdout.on("data", (d) => { output += d.toString(); });
            proc.stderr.on("data", (d) => {
                const t = d.toString().trim();
                if (t)
                    console.log("[Pulse Pipeline]", t);
            });
            proc.on("error", (err) => reject(err));
            proc.on("exit", (code) => {
                if (code !== 0 && !output)
                    return reject(new Error(`Pipeline exit ${code}`));
                try {
                    const parsed = JSON.parse(output);
                    const content = parsed.response ||
                        (parsed.code_changes
                            ? `Generated ${parsed.code_changes.length} files:\n` + parsed.code_changes.map((c) => `  • ${c.file_path}`).join("\n")
                            : JSON.stringify(parsed, null, 2));
                    resolve({ role: "assistant", content });
                }
                catch {
                    resolve({ role: "assistant", content: output || "(no output)" });
                }
            });
        });
    }
    getApiKey() {
        const config = vscode.workspace.getConfiguration("pulse");
        let key = config.get("apiKey") || "";
        if (key)
            return key;
        try {
            const envPath = "D:\\pulse\\.env";
            if (fs.existsSync(envPath)) {
                for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
                    const t = line.trim();
                    if (t.startsWith("OPENROUTER_API_KEY=")) {
                        return t.substring("OPENROUTER_API_KEY=".length).replace(/^["']|["']$/g, "");
                    }
                }
            }
        }
        catch { /* ignore */ }
        return "";
    }
    async directLLM(messages, model) {
        const config = vscode.workspace.getConfiguration("pulse");
        const apiKey = this.getApiKey();
        const baseURL = config.get("baseURL") || "https://openrouter.ai/api/v1";
        const modelName = model || config.get("model") || "openrouter/free";
        if (!apiKey)
            return { role: "assistant", content: "No API key. Set pulse.apiKey in settings or OPENROUTER_API_KEY in D:/pulse/.env." };
        try {
            const resp = await fetch(`${baseURL}/chat/completions`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
                body: JSON.stringify({ model: modelName, messages, max_tokens: 4096, temperature: 0.3 }),
            });
            if (!resp.ok)
                throw new Error(`API ${resp.status}: ${(await resp.text()).substring(0, 200)}`);
            const data = await resp.json();
            return data?.choices?.[0]?.message || { role: "assistant", content: "(empty)" };
        }
        catch (err) {
            return { role: "assistant", content: `Error: ${err instanceof Error ? err.message : String(err)}` };
        }
    }
    // ─── Tools ───────────────────────────
    listTools() {
        return [
            { name: "readFile", description: "Read a file", parameters: { type: "object", properties: { filepath: { type: "string" } }, required: ["filepath"] } },
            { name: "writeFile", description: "Write to a file", parameters: { type: "object", properties: { filepath: { type: "string" }, content: { type: "string" } }, required: ["filepath", "content"] } },
            { name: "runCommand", description: "Run a terminal command", parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } },
            { name: "searchFiles", description: "Search for a pattern in files", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
            { name: "listDir", description: "List directory contents", parameters: { type: "object", properties: { dir: { type: "string" } }, required: ["dir"] } },
        ];
    }
    async callTool(data) {
        const name = data?.tool?.name || data?.name;
        const args = data?.tool?.arguments || data?.arguments || {};
        try {
            switch (name) {
                case "readFile": return await this.readFile(args.filepath);
                case "writeFile": return await this.writeFile(args.filepath, args.content);
                case "runCommand": return await this.runCommand(args.command);
                case "searchFiles": return await this.searchFiles(args.query);
                case "listDir": return await this.listDir(args.dir);
                default: throw new Error(`Unknown tool: ${name}`);
            }
        }
        catch (err) {
            return { error: err.message };
        }
    }
    // ─── IDE Helpers ─────────────────────────────────
    getOpenFiles() {
        return vscode.window.tabGroups.all
            .flatMap(g => g.tabs)
            .filter(t => t.input && "uri" in t.input)
            .map(t => t.input.uri.fsPath);
    }
    async fileExists(filepath) {
        try {
            await vscode.workspace.fs.stat(vscode.Uri.file(filepath));
            return true;
        }
        catch {
            return false;
        }
    }
    async readFile(filepath) {
        const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(filepath));
        return new TextDecoder().decode(bytes);
    }
    async readRangeInFile(filepath, range) {
        const lines = (await this.readFile(filepath)).split("\n");
        return lines.slice(range?.start?.line || 0, (range?.end?.line || lines.length) + 1).join("\n");
    }
    async writeFile(filepath, content) {
        await vscode.workspace.fs.writeFile(vscode.Uri.file(filepath), new TextEncoder().encode(content));
    }
    runCommand(command) {
        return new Promise((resolve, reject) => {
            cp.exec(command, { timeout: 120000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
                if (err && !stdout && !stderr)
                    return reject(err);
                resolve(stdout + (stderr ? `\nSTDERR:\n${stderr}` : ""));
            });
        });
    }
    async listDir(dir) {
        if (!dir)
            return [];
        const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(dir));
        return entries.map(([n, t]) => t === vscode.FileType.Directory ? n + "/" : n);
    }
    async searchFiles(query) {
        if (!query)
            return "";
        const results = await vscode.workspace.findFiles("**/*", "**/node_modules/**", 50);
        return results.filter(u => !u.fsPath.includes("node_modules")).slice(0, 50).map(u => u.fsPath).join("\n");
    }
    showMessage(data) {
        const msg = data?.message || data?.text || "";
        if (data?.type === "error")
            vscode.window.showErrorMessage(msg);
        else if (data?.type === "warning")
            vscode.window.showWarningMessage(msg);
        else
            vscode.window.showInformationMessage(msg);
    }
    killAgent() {
        if (this.agentProcess && !this.agentProcess.killed) {
            this.agentProcess.kill();
            this.agentProcess = null;
        }
    }
}
exports.ContinueToPulseBridge = ContinueToPulseBridge;
//# sourceMappingURL=ContinueToPulseBridge.js.map