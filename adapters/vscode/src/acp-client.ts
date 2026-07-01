/**
 * ACP Client — manages the Pulse agent process and JSON-RPC communication.
 */

import { EventEmitter } from "events";
import { spawn, ChildProcess } from "child_process";
import * as vscode from "vscode";

interface JSONRPCRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

interface JSONRPCResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

interface JSONRPCNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export class PulseClient extends EventEmitter {
  private process: ChildProcess | null = null;
  private requestId = 0;
  private pendingRequests = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
  }>();
  private buffer = "";

  constructor(private binaryPath: string) {
    super();
  }

  isRunning(): boolean {
    return this.process !== null && !this.process.killed;
  }

  async start(): Promise<void> {
    if (this.isRunning()) { return; }

    this.process = spawn(this.binaryPath, ["--stdio"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        RUST_LOG: "info",
        SURPASSING_WORKSPACE: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || "",
        PIPELINE_SCRIPT: "python D:\\pulse\\python\\agents\\pipeline.py",
      },
      cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd(),
    });

    this.process.stdout?.on("data", (data: Buffer) => {
      this.buffer += data.toString();
      this.processBuffer();
    });

    this.process.stderr?.on("data", (data: Buffer) => {
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

  stop(): void {
    if (this.process && !this.process.killed) {
      this.sendNotification("surpassing/shutdown", {});
      setTimeout(() => {
        this.process?.kill();
        this.process = null;
      }, 1000);
    }
  }

  async sendRequest(method: string, params: unknown): Promise<unknown> {
    const id = ++this.requestId;
    const request: JSONRPCRequest = { jsonrpc: "2.0", id, method, params };

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

  sendNotification(method: string, params: unknown): void {
    const notification: JSONRPCNotification = { jsonrpc: "2.0", method, params };
    const jsonLine = JSON.stringify(notification) + "\n";
    this.process?.stdin?.write(jsonLine);
  }

  private processBuffer(): void {
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.trim()) {
        try {
          const message = JSON.parse(line) as JSONRPCResponse | JSONRPCNotification;
          if ("id" in message && message.id !== undefined) {
            const pending = this.pendingRequests.get(message.id);
            if (pending) {
              this.pendingRequests.delete(message.id);
              if ("error" in message && message.error) {
                pending.reject(new Error(message.error.message));
              } else {
                pending.resolve(message.result);
              }
            }
          } else if ("method" in message) {
            this.emit("notification", message);
            this.handleNotification(message as JSONRPCNotification);
          }
        } catch (e) {
          console.error("Failed to parse JSON-RPC message:", line, e);
        }
      }
    }
  }

  private handleNotification(notification: JSONRPCNotification): void {
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

  private async handleHITL(params: unknown): Promise<void> {
    const hitl = params as {
      gateType: string;
      description: string;
      details: Record<string, unknown>;
      timeoutSeconds: number;
    };

    const result = await vscode.window.showWarningMessage(
      `[Pulse] ${hitl.description}`,
      { modal: true, detail: JSON.stringify(hitl.details, null, 2) },
      "Approve",
      "Reject"
    );

    this.sendNotification("surpassing/hitl/response", {
      approved: result === "Approve",
      gateType: hitl.gateType,
    });
  }
}
