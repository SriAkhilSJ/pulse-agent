"use strict";
/**
 * ACP Client — manages the Pulse agent process and JSON-RPC communication.
 */
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
exports.PulseClient = void 0;
const events_1 = require("events");
const child_process_1 = require("child_process");
const vscode = __importStar(require("vscode"));
class PulseClient extends events_1.EventEmitter {
    binaryPath;
    process = null;
    requestId = 0;
    pendingRequests = new Map();
    buffer = "";
    constructor(binaryPath) {
        super();
        this.binaryPath = binaryPath;
    }
    isRunning() {
        return this.process !== null && !this.process.killed;
    }
    async start() {
        if (this.isRunning()) {
            return;
        }
        this.process = (0, child_process_1.spawn)(this.binaryPath, ["--stdio"], {
            stdio: ["pipe", "pipe", "pipe"],
            env: {
                ...process.env,
                RUST_LOG: "info",
                SURPASSING_WORKSPACE: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "",
                PIPELINE_SCRIPT: "python D:\\pulse\\python\\agents\\pipeline.py",
            },
            cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd(),
        });
        this.process.stdout?.on("data", (data) => {
            this.buffer += data.toString();
            this.processBuffer();
        });
        this.process.stderr?.on("data", (data) => {
            console.log(`[Pulse Agent] ${data.toString().trim()}`);
        });
        this.process.on("exit", (code) => {
            console.log(`Pulse agent exited with code ${code}`);
            this.process = null;
            this.emit("disconnected");
        });
        const result = await this.sendRequest("surpassing/initialize", {
            processId: process.pid,
            rootUri: vscode.workspace.workspaceFolders?.[0]?.uri.toString(),
            capabilities: {
                surpassing: {
                    chatPanel: true,
                    inlineSuggestions: true,
                    diffPreview: true,
                },
            },
        });
        console.log("Pulse initialized:", result);
        this.emit("connected", result);
    }
    stop() {
        if (this.process && !this.process.killed) {
            this.sendNotification("surpassing/shutdown", {});
            setTimeout(() => {
                this.process?.kill();
                this.process = null;
            }, 1000);
        }
    }
    async sendRequest(method, params) {
        const id = ++this.requestId;
        const request = { jsonrpc: "2.0", id, method, params };
        return new Promise((resolve, reject) => {
            this.pendingRequests.set(id, { resolve, reject });
            const jsonLine = JSON.stringify(request) + "\n";
            this.process?.stdin?.write(jsonLine, (err) => {
                if (err) {
                    this.pendingRequests.delete(id);
                    reject(err);
                }
            });
            setTimeout(() => {
                if (this.pendingRequests.has(id)) {
                    this.pendingRequests.delete(id);
                    reject(new Error(`Request ${method} timed out`));
                }
            }, 60000);
        });
    }
    sendNotification(method, params) {
        const notification = { jsonrpc: "2.0", method, params };
        const jsonLine = JSON.stringify(notification) + "\n";
        this.process?.stdin?.write(jsonLine);
    }
    processBuffer() {
        const lines = this.buffer.split("\n");
        this.buffer = lines.pop() || "";
        for (const line of lines) {
            if (line.trim()) {
                try {
                    const message = JSON.parse(line);
                    if ("id" in message && message.id !== undefined) {
                        const pending = this.pendingRequests.get(message.id);
                        if (pending) {
                            this.pendingRequests.delete(message.id);
                            if ("error" in message && message.error) {
                                pending.reject(new Error(message.error.message));
                            }
                            else {
                                pending.resolve(message.result);
                            }
                        }
                    }
                    else if ("method" in message) {
                        this.emit("notification", message);
                        this.handleNotification(message);
                    }
                }
                catch (e) {
                    console.error("Failed to parse JSON-RPC message:", line, e);
                }
            }
        }
    }
    handleNotification(notification) {
        switch (notification.method) {
            case "surpassing/notification/progress":
                this.emit("progress", notification.params);
                break;
            case "surpassing/notification/humanInTheLoop":
                this.handleHITL(notification.params);
                break;
            case "surpassing/notification/security":
                this.emit("security", notification.params);
                break;
            case "surpassing/notification/memoryUpdate":
                this.emit("memoryUpdate", notification.params);
                break;
        }
    }
    async handleHITL(params) {
        const hitl = params;
        const result = await vscode.window.showWarningMessage(`[Pulse] ${hitl.description}`, { modal: true, detail: JSON.stringify(hitl.details, null, 2) }, "Approve", "Reject");
        this.sendNotification("surpassing/hitl/response", {
            approved: result === "Approve",
            gateType: hitl.gateType,
        });
    }
}
exports.PulseClient = PulseClient;
//# sourceMappingURL=acp-client.js.map