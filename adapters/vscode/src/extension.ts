/**
 * Pulse Code AI - VS Code Extension
 * 
 * Integrates Continue.dev's GUI as the chat interface,
 * wired to Pulse's ACP/Python backend.
 */

import * as vscode from "vscode";
import * as cp from "child_process";
import { PulseClient } from "./acp-client";
import { ContinueWebviewProvider } from "./continue-gui/ContinueWebviewProvider";

let client: PulseClient | undefined;
let outputChannel: vscode.OutputChannel;
let continueProvider: ContinueWebviewProvider;

export function activate(context: vscode.ExtensionContext): void {
  console.log('[Pulse] activate called');
  outputChannel = vscode.window.createOutputChannel("Pulse Code AI");
  outputChannel.appendLine('Pulse Code AI extension activated');

  // ─── Register Continue GUI sidebar ──────────────────────
  continueProvider = new ContinueWebviewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      ContinueWebviewProvider.viewType,
      continueProvider,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  // ─── Commands ───────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("pulse.startAgent", startAgent),
    vscode.commands.registerCommand("pulse.stopAgent", stopAgent),
    vscode.commands.registerCommand("pulse.runPipeline", runPipeline),
    vscode.commands.registerCommand("pulse.explainCode", explainCode),
    vscode.commands.registerCommand("pulse.generateTests", generateTests),
    vscode.commands.registerCommand("pulse.smartRefactor", smartRefactor),
    vscode.commands.registerCommand("pulse.chat", openContinueChat),
    vscode.commands.registerCommand("pulse.chatPanel", openContinueChat),
    vscode.commands.registerCommand("pulse.runLspDiagnostics", runLspDiagnostics),
    vscode.commands.registerCommand("pulse.lspStatus", showLspStatus),
    outputChannel
  );

  // ─── Status bar: LSP indicator ──────────────────────────
  const lspItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  lspItem.text = "$(beaker) LSP";
  lspItem.tooltip = "Pulse LSP Diagnostics — click to run on active file";
  lspItem.command = "pulse.runLspDiagnostics";
  lspItem.show();
  context.subscriptions.push(lspItem);

  // ─── Autostart ──────────────────────────────────────────
  const config = vscode.workspace.getConfiguration("pulse");
  if (config.get<boolean>("autoStart", false)) {
    startAgent();
  }
}

export function deactivate(): void {
  stopAgent();
}

// ─── Open Continue Chat Panel ─────────────────────────────

async function openContinueChat(): Promise<void> {
  // Focus the sidebar view
  await vscode.commands.executeCommand("workbench.view.extension.pulse-continue");
}

// ─── ACP Agent ────────────────────────────────────────────

async function startAgent(): Promise<void> {
  if (client?.isRunning()) {
    vscode.window.showInformationMessage("Pulse agent is already running");
    return;
  }

  const config = vscode.workspace.getConfiguration("pulse");
  const binaryPath = config.get<string>("agentBinaryPath") || findDefaultBinary();

  if (!binaryPath) {
    vscode.window.showWarningMessage(
      "Pulse Rust binary not found. Use 'Pulse: Run Agent Pipeline' instead."
    );
    return;
  }

  client = new PulseClient(binaryPath);
  client.on("connected", () => {
    outputChannel.appendLine("Pulse ACP agent connected");
    vscode.window.showInformationMessage("Pulse agent connected");
  });
  client.on("disconnected", () => {
    outputChannel.appendLine("Pulse agent disconnected");
  });

  await client.start();
}

function stopAgent(): void {
  client?.stop();
  client = undefined;
  outputChannel.appendLine("Agent stopped");
}

// ─── Direct Python Pipeline ───────────────────────────────

async function runPipeline(): Promise<void> {
  const task = await vscode.window.showInputBox({
    prompt: "What code do you want to generate?",
    placeHolder: "e.g., Create a REST API login endpoint with JWT auth",
    ignoreFocusOut: true,
  });
  if (!task) return;

  const config = vscode.workspace.getConfiguration("pulse");
  const pythonExe = config.get<string>("pythonPath") || "python";
  const agentsDir = config.get<string>("agentsPath") || "D:\\pulse\\python\\agents";

  outputChannel.appendLine("\n═══════════════════════════════════════════");
  outputChannel.appendLine(`⚡ Pulse Agent Pipeline`);
  outputChannel.appendLine(`   Task: ${task}`);
  outputChannel.appendLine("═══════════════════════════════════════════\n");
  outputChannel.show();

  return new Promise<void>((resolve) => {
    const ws = vscode.workspace.rootPath || "";
    const proc = cp.spawn(pythonExe, ["pipeline.py", "--task", task, "--context", ws, "--platform", "ide"], {
      cwd: agentsDir,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let output = "";
    proc.stdout.on("data", (data: Buffer) => {
      const text = data.toString();
      output += text;
      outputChannel.append(text);
    });
    proc.stderr.on("data", (data: Buffer) => {
      const line = data.toString().trim();
      if (line) outputChannel.appendLine(`[agent] ${line}`);
    });
    proc.on("exit", (code) => {
      outputChannel.appendLine(`\n─── Pipeline exited (code ${code}) ───\n`);
      if (code === 0) {
        try {
          const result = JSON.parse(output);
          if (result.code_changes) {
            outputChannel.appendLine(`Generated ${result.code_changes.length} file(s):`);
            for (const change of result.code_changes) {
              outputChannel.appendLine(`  • ${change.file_path} (${change.action})`);
            }
          }
        } catch { /* raw output shown */ }
      }
      resolve();
    });
  });
}

// ─── ACP-based commands ───────────────────────────────────

async function chatCommand(): Promise<void> {
  const message = await vscode.window.showInputBox({
    prompt: "Ask Pulse Agent",
    placeHolder: "e.g., Explain this function",
  });
  if (!message) return;
  if (!client?.isRunning()) {
    vscode.window.showWarningMessage("Agent not running. Run 'Start Pulse Agent' first.");
    return;
  }
  try {
    const result = await client.sendRequest("surpassing/chat", { message, mode: "chat" });
    const r = result as { data?: { response?: string } };
    outputChannel.appendLine(`> ${message}`);
    outputChannel.appendLine(`< ${r?.data?.response || JSON.stringify(result)}`);
    outputChannel.show();
  } catch (err) {
    vscode.window.showErrorMessage(`Chat failed: ${err}`);
  }
}

async function explainCode(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  const selection = editor.selection;
  const code = editor.document.getText(
    selection.isEmpty ? editor.document.lineAt(selection.active.line).range : selection
  );
  if (!client?.isRunning()) {
    vscode.window.showWarningMessage("Agent not running. Use 'Pulse: Run Agent Pipeline' instead.");
    return;
  }
  try {
    const result = await client.sendRequest("surpassing/chat", {
      message: `Explain this code:\n${code}`,
      mode: "explain",
      context: { currentFile: editor.document.uri.fsPath },
    });
    const r = result as { data?: { response?: string } };
    outputChannel.appendLine(`< ${r?.data?.response || JSON.stringify(result)}`);
    outputChannel.show();
  } catch (err) {
    vscode.window.showErrorMessage(`Explain failed: ${err}`);
  }
}

async function generateTests(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  if (!client?.isRunning()) {
    vscode.window.showWarningMessage("Agent not running. Use 'Pulse: Run Agent Pipeline' instead.");
    return;
  }
  try {
    const result = await client.sendRequest("surpassing/chat", {
      message: `Generate tests for ${editor.document.uri.fsPath}`,
      mode: "test",
      context: { currentFile: editor.document.uri.fsPath },
    });
    const r = result as { data?: { response?: string } };
    outputChannel.appendLine(`< ${r?.data?.response || JSON.stringify(result)}`);
    outputChannel.show();
  } catch (err) {
    vscode.window.showErrorMessage(`Generate tests failed: ${err}`);
  }
}

async function smartRefactor(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  const selection = editor.selection;
  const code = editor.document.getText(selection);
  if (!code) {
    vscode.window.showWarningMessage("Select code to refactor.");
    return;
  }
  if (!client?.isRunning()) {
    vscode.window.showWarningMessage("Agent not running. Use 'Pulse: Run Agent Pipeline' instead.");
    return;
  }
  try {
    const result = await client.sendRequest("surpassing/chat", {
      message: `Refactor this code:\n${code}`,
      mode: "refactor",
      context: { currentFile: editor.document.uri.fsPath },
    });
    const r = result as { data?: { response?: string } };
    outputChannel.appendLine(`< ${r?.data?.response || JSON.stringify(result)}`);
    outputChannel.show();
  } catch (err) {
    vscode.window.showErrorMessage(`Refactor failed: ${err}`);
  }
}

function findDefaultBinary(): string | undefined {
  const { existsSync } = require("fs");
  const { join } = require("path");
  const candidates = [
    join("D:", "pulse", "target", "debug", "surpassing.exe"),
    join(process.env.USERPROFILE || "", ".cargo", "bin", "surpassing.exe"),
    join("D:", "pulse", "target", "release", "surpassing.exe"),
  ];
  return candidates.find((p: string) => existsSync(p));
}

// ─── LSP Commands ─────────────────────────────────────────

const PYTHON_EXE = 'C:\\Users\\Administrator\\AppData\\Local\\Programs\\Python\\Python311\\python.exe';

async function runLspDiagnostics(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) { vscode.window.showWarningMessage("Open a file first."); return; }
  const filePath = editor.document.uri.fsPath;
  if (!filePath || filePath.startsWith('extension-output-') || filePath.startsWith('output:')) {
    vscode.window.showWarningMessage("Open a real file in the editor tab.");
    return;
  }
  const { existsSync } = require("fs");
  if (!existsSync(filePath)) { vscode.window.showWarningMessage(`File not found: ${filePath}`); return; }

  outputChannel.appendLine("\n═══════════════════════════════════════════");
  outputChannel.appendLine(`🔍 LSP Diagnostics: ${filePath}`);
  outputChannel.appendLine("═══════════════════════════════════════════");

  const uri = editor.document.uri;
  const vscodeDiags = vscode.languages.getDiagnostics(uri);
  if (vscodeDiags.length > 0) {
    outputChannel.appendLine(`[VS Code built-in] ${vscodeDiags.length} diagnostic(s):`);
    for (const d of vscodeDiags) {
      const sev = ['ERROR','WARN','INFO','HINT'][d.severity] || 'DIAG';
      const line = d.range.start.line + 1;
      const col = d.range.start.character + 1;
      outputChannel.appendLine(`  ${sev} L${line}:${col} ${d.message.split('\n')[0]}`);
      if (d.code) outputChannel.appendLine(`         code: ${d.code}`);
    }
    vscode.window.showInformationMessage(
      `VS Code: ${vscodeDiags.filter(d=>d.severity===0).length} err, ${vscodeDiags.filter(d=>d.severity===1).length} warn`
    );
  } else {
    outputChannel.appendLine("[VS Code built-in] No diagnostics (clean)");
  }

  const ext = filePath.split('.').pop()?.toLowerCase();
  const needsExternal = ['rs', 'go', 'py', 'php', 'java', 'kt', 'kts'];
  if (ext && needsExternal.includes(ext)) {
    outputChannel.appendLine("\n─── External LSP server diagnostics ───");
    const agentsDir = "D:\\pulse\\python\\agents";
    const script = [
      `import sys, json`,
      `sys.path.insert(0, ${JSON.stringify(agentsDir)})`,
      `from pulse_lsp import get_service`,
      `svc = get_service()`,
      `if not svc:`,
      `  print('{"error": "LSP service unavailable"}')`,
      `  sys.exit(0)`,
      `diags = svc.open_and_diagnostics(${JSON.stringify(filePath)})`,
      `print(json.dumps(diags, indent=2))`,
    ].join('\n');

    const proc = cp.spawn(PYTHON_EXE, ['-c', script], { cwd: agentsDir, stdio: ['pipe', 'pipe', 'pipe'] });
    let extOutput = '';
    proc.stdout.on('data', (data: Buffer) => { extOutput += data.toString(); outputChannel.append(data.toString()); });
    proc.stderr.on('data', (data: Buffer) => { const t = data.toString().trim(); if (t) outputChannel.appendLine(`[lsp] ${t}`); });
    proc.on('error', (err: Error) => outputChannel.appendLine(`[lsp] SPAWN ERROR: ${err.message}`));
    proc.on('exit', (code: number | null) => outputChannel.appendLine(`─── External LSP exited (code ${code}) ───`));
  }
}

async function showLspStatus(): Promise<void> {
  outputChannel.appendLine("\n═══════════════════════════════════════════");
  outputChannel.appendLine("📊 LSP Server Status");
  outputChannel.appendLine("═══════════════════════════════════════════");

  const agentsDir = "D:\\pulse\\python\\agents";
  const script = [
    `import sys`,
    `sys.path.insert(0, ${JSON.stringify(agentsDir)})`,
    `from pulse_lsp.servers import get_all_servers`,
    `from pulse_lsp.install import detect_status`,
    `for s in get_all_servers():`,
    `  st = detect_status(s.server_id)`,
    `  print(f"{s.server_id:30s} {st:12s}  {s.description}")`,
    `print()`,
    `print(f"Total: {len(get_all_servers())} servers registered")`,
  ].join('\n');

  const proc = cp.spawn(PYTHON_EXE, ['-c', script], { cwd: agentsDir, stdio: ['pipe', 'pipe', 'pipe'] });
  proc.stdout.on('data', (data: Buffer) => outputChannel.append(data.toString()));
  proc.stderr.on('data', (data: Buffer) => { const t = data.toString().trim(); if (t) outputChannel.appendLine(`[lsp-err] ${t}`); });
  proc.on('error', (err: Error) => outputChannel.appendLine(`[lsp] SPAWN ERROR: ${err.message}`));
  proc.on('close', () => outputChannel.appendLine("────────────────────────────────────────"));
}
