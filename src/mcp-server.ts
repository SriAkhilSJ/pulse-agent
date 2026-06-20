// src/mcp-server.ts
// MCP (Model Context Protocol) server that exposes all registered tools.
// Uses HTTP with SSE transport. Writes port file for discovery.
// Auth token persisted to disk so MCP clients survive server restart.

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';
import { ToolRegistry } from './tool-registry';

import { config } from './config';

const MCP_VERSION = '2024-11-05';

interface McpRequest {
  jsonrpc: string;
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

interface McpResponse {
  jsonrpc: string;
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string };
}

export class McpServer {
  private server: http.Server | null = null;
  private port: number = 0;
  private registry: ToolRegistry;
  private authToken: string = '';
  private clients: http.ServerResponse[] = [];

  constructor(registry: ToolRegistry) {
    this.registry = registry;
    // Persist auth token to disk so MCP clients survive server restart
    const tokenFile = path.join(os.homedir(), '.pulse', 'mcp-token.json');
    try {
      if (fs.existsSync(tokenFile)) {
        const saved = JSON.parse(fs.readFileSync(tokenFile, 'utf-8'));
        if (saved.authToken) { this.authToken = saved.authToken; }
      }
    } catch { /* ignore — will generate new */ }
    if (!this.authToken) {
      this.authToken = Math.random().toString(36).substring(2) + Math.random().toString(36).substring(2);
      try {
        fs.mkdirSync(path.dirname(tokenFile), { recursive: true });
        fs.writeFileSync(tokenFile, JSON.stringify({ authToken: this.authToken }), 'utf-8');
        // Restrict token file to owner-only read/write (Unix)
        try { fs.chmodSync(tokenFile, 0o600); } catch { /* ignore on Windows */ }
      } catch { /* ignore */ }
    }
  }

  start(preferredPort: number = 0): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

        if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

        if (req.url === '/sse' && req.method === 'GET') {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          });
          this.clients.push(res);
          res.write(`event: endpoint\ndata: /message?port=${this.port}\n\n`);
          req.on('close', () => { this.clients = this.clients.filter(c => c !== res); });
          return;
        }

        if (req.url?.startsWith('/message') && req.method === 'POST') {
          let body = '';
          req.on('data', chunk => body += chunk);
          req.on('end', () => this.handleMessage(body, res));
          return;
        }

        if (req.url === '/tools' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ tools: this.getToolsList() }));
          return;
        }

        res.writeHead(404);
        res.end('Not found');
      });

      this.server.listen(preferredPort, '127.0.0.1', () => {
        const addr = this.server!.address() as any;
        this.port = addr.port;
        this.writePortFile();
        console.log(`🔌 MCP server running on http://127.0.0.1:${this.port}`);
        resolve(this.port);
      });

      this.server.on('error', reject);
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      this.clients.forEach(c => c.end());
      this.clients = [];
      if (this.server) {
        this.server.close(() => {
          this.server = null;
          this.removePortFile();
          console.log('🔌 MCP server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  getPort(): number { return this.port; }
  getAuthToken(): string { return this.authToken; }

  private async handleMessage(body: string, res: http.ServerResponse): Promise<void> {
    try {
      const request: McpRequest = JSON.parse(body);
      let result: unknown;

      switch (request.method) {
        case 'initialize':
          result = {
            protocolVersion: MCP_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: 'pulse-agent', version: '0.0.1' },
          };
          break;

        case 'tools/list':
          result = { tools: this.getToolsList() };
          break;

        case 'tools/call': {
          const params = request.params as { name: string; arguments: Record<string, unknown> };
          const toolResult = await this.registry.execute(params.name, params.arguments);
          result = { content: [{ type: 'text', text: toolResult }] };
          break;
        }

        default:
          res.writeHead(400);
          res.end(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: `Unknown method: ${request.method}` } }));
          return;
      }

      const response: McpResponse = { jsonrpc: '2.0', id: request.id, result };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(response));
    } catch (err) {
      res.writeHead(500);
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32600, message: (err as Error).message } }));
    }
  }

  private getToolsList(): object[] {
    return this.registry.getToolsSchema().map((t: any) => ({
      name: t.function.name,
      description: t.function.description,
      inputSchema: t.function.parameters,
    }));
  }

  private writePortFile(): void {
    try {
      const wf = vscode.workspace.workspaceFolders;
      const base = wf ? wf[0].uri.fsPath : process.cwd();
      const dir = path.join(base, '.pulse');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'mcp-port.json'), JSON.stringify({
        port: this.port,
        authToken: this.authToken,
        url: `http://127.0.0.1:${this.port}`,
        pid: process.pid,
      }, null, 2));
    } catch { /* ignore */ }
  }

  private removePortFile(): void {
    try {
      const wf = vscode.workspace.workspaceFolders;
      const base = wf ? wf[0].uri.fsPath : process.cwd();
      const file = path.join(base, '.pulse', 'mcp-port.json');
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch { /* ignore */ }
  }
}
