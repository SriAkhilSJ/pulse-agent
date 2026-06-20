// src/onboarding.ts
// Welcome & Onboarding — First-run experience for PulseCode AI
// Like Cursor's welcome tab / Windsurf's getting started

import * as vscode from 'vscode';

export class OnboardingProvider {
  private context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  async checkAndShow(): Promise<void> {
    const hasSeenWelcome = this.context.globalState.get<boolean>('hasSeenWelcome', false);
    if (!hasSeenWelcome) {
      await this.showWelcome();
    }
  }

  async showWelcome(): Promise<void> {
    const panel = vscode.window.createWebviewPanel(
      'pulsecode.welcome',
      'Welcome to PulseCode AI',
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    panel.webview.html = this.getWelcomeHtml();

    panel.webview.onDidReceiveMessage(async (msg) => {
      if (msg.command === 'configure') {
        await vscode.commands.executeCommand('pulse.openSettings');
        panel.dispose();
      } else if (msg.command === 'startChat') {
        // Just show a notification - the agent icon is in the left activitybar
        vscode.window.showInformationMessage('PulseCode AI: Click the PulseCode icon in the left sidebar to open the agent panel.');
        panel.dispose();
      } else if (msg.command === 'openFile') {
        const uri = vscode.Uri.file(msg.filePath);
        await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(uri);
        panel.dispose();
      } else if (msg.command === 'dismiss') {
        this.context.globalState.update('hasSeenWelcome', true);
        panel.dispose();
      }
    });
  }

  private getWelcomeHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 40px; background: #0B0A0F; color: #ECEAF2; line-height: 1.6; }
    .container { max-width: 640px; margin: 0 auto; }
    h1 { font-size: 28px; font-weight: 700; margin-bottom: 8px; background: linear-gradient(135deg, #C3B0FF, #8B5CF6); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .subtitle { color: rgba(236,234,242,.6); font-size: 15px; margin-bottom: 32px; }
    .card { background: rgba(22,19,30,.92); border: 1px solid rgba(139,92,246,.18); border-radius: 14px; padding: 24px; margin-bottom: 16px; }
    .card h3 { font-size: 16px; margin-bottom: 8px; color: #C3B0FF; }
    .card p { font-size: 13px; color: rgba(236,234,242,.7); margin: 0; }
    .btn { display: inline-block; padding: 10px 20px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; border: none; margin-right: 8px; margin-top: 12px; }
    .btn-primary { background: #8B5CF6; color: #fff; }
    .btn-primary:hover { background: #7C3AED; }
    .btn-secondary { background: rgba(139,92,246,.12); color: #C3B0FF; }
    .btn-secondary:hover { background: rgba(139,92,246,.2); }
    .features { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 24px; }
    .feature { background: rgba(139,92,246,.06); border-radius: 10px; padding: 16px; }
    .feature .icon { font-size: 20px; margin-bottom: 6px; }
    .feature h4 { font-size: 13px; margin: 0 0 4px; color: #ECEAF2; }
    .feature p { font-size: 11px; color: rgba(236,234,242,.5); margin: 0; }
    code { background: rgba(139,92,246,.12); padding: 2px 6px; border-radius: 4px; font-family: 'SF Mono', Menlo, monospace; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>PulseCode AI</h1>
    <p class="subtitle">Your autonomous AI coding agent. Built for speed.</p>

    <div class="card">
      <h3>Get Started</h3>
      <p>Type <code>@PulseCode</code> in the chat panel to start. Or use the agent in the secondary sidebar.</p>
      <button class="btn btn-primary" onclick="sendMsg('startChat')">Open Chat</button>
      <button class="btn btn-secondary" onclick="sendMsg('configure')">Configure</button>
    </div>

    <div class="features">
      <div class="feature">
        <div class="icon">⚡</div>
        <h4>Agent Loop</h4>
        <p>1 API call per iteration. Tools execute in parallel.</p>
      </div>
      <div class="feature">
        <div class="icon">🧠</div>
        <h4>Context Engine</h4>
        <p>Codebase indexer with symbol search. Knows your project.</p>
      </div>
      <div class="feature">
        <div class="icon">🔧</div>
        <h4>50+ Tools</h4>
        <p>File, terminal, browser, git, build, vision, and more.</p>
      </div>
      <div class="feature">
        <div class="icon">🤖</div>
        <h4>Sub-Agents</h4>
        <p>Spawn parallel agents for complex tasks.</p>
      </div>
    </div>
  </div>
  <script>
    function sendMsg(cmd) {
      const api = acquireVsCodeApi();
      api.postMessage({ command: cmd });
    }
  </script>
</body>
</html>`;
  }
}
