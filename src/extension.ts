// src/extension.ts
// PulseCode AI Agent -- Main entry point.
// Builtin AI IDE extension (like Cursor/Windsurf) with native chat integration.

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

// ── Load .env file into process.env ──────────────────────────────
function loadEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  try {
    const candidates = [path.join(__dirname, '..', '.env'), path.join(__dirname, '..', '..', '.env')];
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

const envConfig = loadEnv();

import { ToolRegistry } from './tool-registry';
import { Agent } from './agent';
import { SkillsLoader } from './skills-loader';
import { McpServer } from './mcp-server';
import { Memory, DEFAULT_SETTINGS } from './memory';
import { MemorySystem } from './memory-system';
import { SessionDB } from './session-db';
import { ContextEngine } from './context-engine';
import { RulesManager } from './rules-manager';
import { FlowStateManager } from './flow-state';
import { InlineSuggestionProvider } from './inline-suggestions';
import { DiffDecorationProvider } from './diff-decorations';
import { StatusBarController } from './statusbar';
import { Telemetry } from './telemetry';
import { OnboardingProvider } from './onboarding';
import { FileMentionProvider } from './file-mention-provider';
import { PulseCodeChatParticipant } from './chat-participant';

// Tool imports
import {
  readFileTool, writeFileTool, listFilesTool, getCurrentFileTool,
  editFileTool, deleteFileTool, searchCodeTool, updateExtensionCodeTool,
  rollbackFileTool, clearReadCache,
} from './tools/file-tools';
import { runTerminalTool, detectTerminalProfile, getShellInfo } from './tools/terminal-tools';
import {
  browserNavigate, browserClick, browserType, browserScreenshot,
  browserAssertText, browserGetText, browserFind, browserWait,
  browserFormFill, browserScroll, browserHover, browserExecute, closeBrowser,
} from './tools/browser-tools';
import {
  desktopMoveMouse, desktopClick, desktopDoubleClick, desktopType, desktopTypeSlow,
  desktopPressKey, desktopScroll, desktopScreenshot, desktopGetScreenSize,
  desktopGetActiveWindow, desktopFindImage, desktopClickImage,
} from './tools/desktop-tools';
import {
  androidDevices, androidGetInfo, androidLaunch, androidClick, androidClickText,
  androidType, androidSwipe, androidScreenshot, androidGetUI, androidWait,
  androidBack, androidHome, androidMenu,
} from './tools/android-tools';
import { audioRecord, audioPlay, audioTranscribe } from './tools/audio-tools';
import { seeImage, assertImageContains } from './tools/vision-tools';
import { generateImage } from './tools/image-gen-tools';
import { spawnAgentTool, getSubagentResultTool, executePlanTool, getActiveSubAgents, registerSubAgentResult } from './tools/agent-tools';
import { webSearchTool, webFetchTool } from './tools/web-tools';
import { logChangeTool, getChangeLogTool, revertChangesTool, clearChangeLog } from './tools/change-tools';
import { todoTool } from './tools/todo-tool';
import { gitStatusTool, gitDiffTool, gitLogTool, gitBranchTool, gitCommitTool, gitStashTool } from './tools/git-tools';
import { detectBuildSystemTool, parseBuildErrorsTool, getRecommendedBuildCommandTool } from './tools/build-tools';
import { autoFixBuildTool, quickFixLintTool } from './tools/autofix-tools';

// State
let registry: ToolRegistry;
let agent: Agent;
let skillsLoader: SkillsLoader;
let mcpServer: McpServer;
let memory: Memory;
let memorySystem: MemorySystem;
let sessionDB: SessionDB;
let contextEngine: ContextEngine;
let rulesManager: RulesManager;
let flowState: FlowStateManager;
let inlineSuggestions: InlineSuggestionProvider;
let diffDecorations: DiffDecorationProvider;
let statusBar: StatusBarController;
let telemetry: Telemetry;
let onboarding: OnboardingProvider;
let currentModel = '';
let currentBaseURL = '';
let currentApiKey = '';
let webviewView: vscode.WebviewView | null = null;

// ── Helper: Resolve config from env ───────────────────────────────
// Re-reads .env file each time so provider switches pick up new values
function resolveConfig() {
  // Re-load .env to pick up any changes
  loadEnv();
  const provider = (process.env['PROVIDER'] || 'openrouter').toLowerCase();
  const prefix = provider.toUpperCase();

  currentModel = process.env[prefix + '_MODEL']
    || process.env['CUSTOM_MODEL']
    || process.env['OPENROUTER_MODEL']
    || 'openrouter/owl-alpha';

  currentBaseURL = process.env[prefix + '_URL']
    || process.env['CUSTOM_URL']
    || process.env['OPENROUTER_URL']
    || 'https://openrouter.ai/api/v1';

  currentApiKey = process.env[prefix + '_API_KEY']
    || process.env['CUSTOM_API_KEY']
    || process.env['OPENROUTER_API_KEY']
    || process.env['API_KEY']
    || '';

  console.log('[PulseCode] Provider:', provider, 'Model:', currentModel, 'URL:', currentBaseURL);
}
let shellInfo: { name: string; path: string; args: string[]; platform: string } | undefined;

// ── Helper: Get API key ──────────────────────────────────────────
// Respects the active provider — reads from the provider-specific env key
async function getApiKey(): Promise<string> {
  if (currentApiKey) return currentApiKey;
  // Try to resolve from current provider env key first
  const provider = (process.env['PROVIDER'] || 'openrouter').toLowerCase();
  const prefix = provider.toUpperCase();
  const envKey = process.env[prefix + '_API_KEY']
    || process.env['CUSTOM_API_KEY']
    || process.env['OPENROUTER_API_KEY']
    || process.env['API_KEY']
    || '';
  if (envKey) {
    currentApiKey = envKey;
    return currentApiKey;
  }
  // Fall back to user input
  const input = await vscode.window.showInputBox({ prompt: 'Enter your API key', password: true });
  if (input) {
    currentApiKey = input;
    const cfg = vscode.workspace.getConfiguration('pulse');
    await cfg.update('apiKey', input, vscode.ConfigurationTarget.Global);
    return currentApiKey;
  }
  throw new Error('API key is required. Set it in .env or via Pulse: Set API Key command.');
}

// ── Webview View Provider for Secondary Side Bar ────────────────
class AgentWebViewProvider implements vscode.WebviewViewProvider {
  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly getAgent: () => Agent | undefined
  ) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    // Store reference so other commands can post messages
    (globalThis as any).__pulseWebview = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      enableCommandUris: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'out'),
        vscode.Uri.joinPath(this.context.extensionUri, 'src', 'webview')
      ]
    };

    const webviewJsUri = webviewView.webview.asWebviewUri(
          vscode.Uri.joinPath(this.context.extensionUri, 'out', 'webview.js')
        );
        const webviewCssUri = webviewView.webview.asWebviewUri(
          vscode.Uri.joinPath(this.context.extensionUri, 'out', 'webview.css')
        );

        webviewView.webview.html = `<!DOCTYPE html>
    <html lang="en" data-theme="pulse-ink">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <link rel="stylesheet" href="${webviewCssUri}">
      <style>
        body { margin: 0; padding: 0; height: 100vh; overflow: hidden; background: var(--pc-bg-base); }
        #root { height: 100vh; }
      </style>
    </head>
    <body>
      <div id="root"></div>
      <script src="${webviewJsUri}"></script>
    </body>
    </html>`;

    webviewView.webview.onDidReceiveMessage((message: any) => {
      if (message.command === 'chat') {
        const agent = this.getAgent();
        if (!agent) {
          webviewView.webview.postMessage({ command: 'error', message: 'Agent not initialized' });
          return;
        }
        const requestId = message.requestId;

        // Streaming callbacks — forward each event to the webview in real-time
        const onThinking = (text: string) => {
          webviewView!.webview.postMessage({ command: 'thinking', text, requestId });
        };
        const onTextDelta = (text: string) => {
          webviewView!.webview.postMessage({ command: 'textDelta', text, requestId });
        };
        const onThinkingDelta = (text: string) => {
          webviewView!.webview.postMessage({ command: 'thinkingDelta', text, requestId });
        };
        const onToolStep = (step: any) => {
          webviewView!.webview.postMessage({ command: 'toolStep', step, requestId });
        };

        // Wrap agent.chat in a hard timeout — if it takes >3min, something is wrong
        const chatTimeoutMs = 180_000;
        const chatPromise = agent.chat(
          message.text || '',
          undefined,      // conversationHistory
          onToolStep,
          onThinking,
          onTextDelta,
          onThinkingDelta,
        );
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Request timed out after ' + (chatTimeoutMs/1000) + 's. The LLM endpoint is not responding. Check your API URL and network connection.')), chatTimeoutMs)
        );
        Promise.race([chatPromise, timeoutPromise]).then(result => {
          webviewView!.webview.postMessage({
            command: 'response',
            requestId,
            text: result.response,
          });
        }).catch(err => {
          // Clean error message — strip HTML tags and truncate
          const rawMsg = err.message || String(err);
          const cleanMsg = rawMsg.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 500);
          webviewView!.webview.postMessage({
            command: 'response',
            requestId,
            error: cleanMsg,
          });
        });
      }

      if (message.command === 'stop') {
        // Abort the ACTIVE LLM call, not create a new signal
        const agent = this.getAgent();
        if (agent) {
          // The agent checks abortSignal at the start of each LLM call and mid-stream.
          // We need to abort the controller that's currently in use.
          const ctrl = (agent as any)._activeAbortController as AbortController | undefined;
          if (ctrl) {
            ctrl.abort();
          }
          // Also set the signal so the next iteration checks it
          const ac = new AbortController();
          ac.abort(); // immediately aborted
          agent.setAbortSignal(ac.signal);
        }
        webviewView.webview.postMessage({ command: 'stopped' });
      }

      if (message.command === 'getHistory') {
        // Load session history from SessionDB and send back to webview
        const history = sessionDB.getSessionMessages(message.sessionId);
        const historyMessages = history.map((m: any) => ({
          role: m.role === 'tool' ? 'assistant' : m.role,
          content: m.content,
        }));
        webviewView.webview.postMessage({ command: 'loadHistory', history: historyMessages, sessionId: message.sessionId });
      }

      if (message.command === 'getSessions') {
        const sessions = sessionDB.getRecentSessions(20);
        webviewView.webview.postMessage({ command: 'sessionList', sessions });
      }

      if (message.command === 'searchSessions') {
        const results = sessionDB.searchSessions(message.query);
        webviewView.webview.postMessage({ command: 'sessionSearchResults', results });
      }

      if (message.command === 'resumeSession') {
        // Load history for the resumed session
        const history = sessionDB.getSessionMessages(message.sessionId);
        const historyMessages = history.map((m: any) => ({
          role: m.role === 'tool' ? 'assistant' : m.role,
          content: m.content,
        }));
        webviewView.webview.postMessage({ command: 'loadHistory', history: historyMessages, sessionId: message.sessionId });
        webviewView.webview.postMessage({ command: 'newSessionStarted' });
      }

      if (message.command === 'deleteSession') {
        sessionDB.clearSession(message.sessionId);
        webviewView.webview.postMessage({ command: 'sessionDeleted', sessionId: message.sessionId });
      }

      if (message.command === 'newSession') {
        webviewView.webview.postMessage({ command: 'newSessionStarted' });
      }

      if (message.command === 'askUserResponse') {
        // Forward user's answer back to the agent's pending question
        // The agent is blocked on AskUserError, so we resolve via a callback
        if ((agent as any)._askUserResolve) {
          (agent as any)._askUserResolve(message.answer);
        }
      }

      if (message.command === 'permissionResponse') {
        if ((agent as any)._permissionResolve) {
          (agent as any)._permissionResolve(message.decision);
        }
      }

      if (message.command === 'switchProvider') {
        process.env['PROVIDER'] = message.provider;
        resolveConfig();
        const agent = this.getAgent();
        if (agent) {
          agent.setModel(currentModel);
          agent.setBaseURL(currentBaseURL);
          agent.setApiKey(currentApiKey);
        }
        statusBar.setModel(currentModel);
        // Also update MemorySystem's LLM config so fact extraction uses new provider
        memorySystem.setLlmConfig({ apiKey: currentApiKey, baseURL: currentBaseURL, model: currentModel });
        webviewView.webview.postMessage({
          command: 'modelUpdate',
          model: currentModel,
          provider: message.provider,
          baseURL: currentBaseURL,
        });
      }
    });

    // Send current model info to webview on connect
    setTimeout(() => {
      webviewView.webview.postMessage({
        command: 'modelUpdate',
        model: currentModel,
        provider: (process.env['PROVIDER'] || 'openrouter'),
        baseURL: currentBaseURL,
      });
    }, 500);
  }
}

// ── Extension Activation ────────────────────────────────────────
export async function activate(context: vscode.ExtensionContext) {
  console.log('=== PulseCode AI Agent v0.3.0 (Builtin) ===');

  // Initialize telemetry first
  telemetry = new Telemetry();

  resolveConfig();

  // ── Initialize systems ──────────────────────────────────────────
  registry = new ToolRegistry();
  memory = new Memory(context);
  memorySystem = new MemorySystem(memory);
  sessionDB = new SessionDB(context);
  contextEngine = new ContextEngine();
  rulesManager = new RulesManager();
  flowState = new FlowStateManager();
  inlineSuggestions = new InlineSuggestionProvider();
  diffDecorations = new DiffDecorationProvider();
  statusBar = new StatusBarController();
  skillsLoader = new SkillsLoader();
  mcpServer = new McpServer(registry);
  onboarding = new OnboardingProvider(context);

  // ── Register ALL tools ──────────────────────────────────────────
  const toolFns = [
    readFileTool, writeFileTool, listFilesTool, getCurrentFileTool,
    editFileTool, deleteFileTool, searchCodeTool, updateExtensionCodeTool,
    rollbackFileTool, clearReadCache,
    runTerminalTool, detectTerminalProfile, getShellInfo,
    webSearchTool, webFetchTool,
    logChangeTool, getChangeLogTool, revertChangesTool, clearChangeLog,
    todoTool,
    seeImage, assertImageContains, generateImage,
    spawnAgentTool, getSubagentResultTool, executePlanTool,
    gitStatusTool, gitDiffTool, gitLogTool, gitBranchTool, gitCommitTool, gitStashTool,
    detectBuildSystemTool, parseBuildErrorsTool, getRecommendedBuildCommandTool,
    autoFixBuildTool, quickFixLintTool,
  ];
  for (const fn of toolFns) {
    registry.register(fn as any);
  }

  const browserTools = [
    browserNavigate, browserClick, browserType, browserScreenshot,
    browserAssertText, browserGetText, browserFind, browserWait,
    browserFormFill, browserScroll, browserHover, browserExecute, closeBrowser,
  ];
  for (const fn of browserTools) {
    registry.register(fn as any);
  }

  const desktopTools = [
    desktopMoveMouse, desktopClick, desktopDoubleClick, desktopType, desktopTypeSlow,
    desktopPressKey, desktopScroll, desktopScreenshot, desktopGetScreenSize,
    desktopGetActiveWindow, desktopFindImage, desktopClickImage,
  ];
  for (const fn of desktopTools) {
    registry.register(fn as any);
  }

  const androidTools = [
    androidDevices, androidGetInfo, androidLaunch, androidClick, androidClickText,
    androidType, androidSwipe, androidScreenshot, androidGetUI, androidWait,
    androidBack, androidHome, androidMenu,
  ];
  for (const fn of androidTools) {
    registry.register(fn as any);
  }

  registry.register(audioRecord as any);
  registry.register(audioPlay as any);
  registry.register(audioTranscribe as any);

  // Git tools already registered in toolFns above — skip duplicate registration

  registry.register(detectBuildSystemTool as any);
  registry.register(parseBuildErrorsTool as any);
  registry.register(getRecommendedBuildCommandTool as any);
  registry.register(autoFixBuildTool as any);
  registry.register(quickFixLintTool as any);

  // ── Initialize async systems ────────────────────────────────────
  contextEngine.initialize();
  rulesManager.initialize();
  flowState.initialize();

  const toolCount = registry.getToolNames().length;
  const skillCount = skillsLoader.getAllSkills().length;
  const contextSize = contextEngine.getIndexSize();
  console.log(`OK ${toolCount} tools | ${skillCount} skills | context: ${contextSize} files`);

  // ── Wire context builder into agent ─────────────────────────────
  agent = new Agent(currentApiKey, currentBaseURL, registry, { model: currentModel, shellInfo });
  agent.setMemorySystem(memorySystem);

  // Enable extended thinking/reasoning (Claude-style thinking blocks)
  // For OpenRouter, this sends both 'thinking' and 'reasoning' params so the provider picks what it supports
  agent.setThinking({ type: 'enabled', budget_tokens: 10000 }, 'medium');

  // Wire up MemorySystem with current LLM config so fact extraction works
  memorySystem.setLlmConfig({ apiKey: currentApiKey, baseURL: currentBaseURL, model: currentModel });
  agent.setContextBuilder(() => {
    let ctx = '';
    const rules = rulesManager.getRulesForPrompt();
    if (rules) ctx += rules;
    const flow = flowState.getFlowContext();
    if (flow) ctx += flow;
    const fileCtx = contextEngine.getCurrentContext();
    if (fileCtx) ctx += fileCtx;
    return ctx;
  });
  inlineSuggestions.setAgent(agent);

  // ── Track tool execution for status bar + diff decorations ──────
  agent.setOnToolStepCallback((step) => {
    if (step.status === 'running') {
      statusBar.setStatus('working');
    } else if (step.status === 'done') {
      statusBar.setStatus('idle');
    } else if (step.status === 'error') {
      statusBar.setStatus('error');
    }
    telemetry.track(step.status === 'error' ? 'tool_error' : 'tool_call', {
      tool_name: step.toolName,
    });
  });

  // ── Register inline suggestions ─────────────────────────────────
  const selector = { scheme: 'file', language: '*' };
  context.subscriptions.push(
    vscode.languages.registerInlineCompletionItemProvider(selector, inlineSuggestions)
  );
  console.log('[PulseCode AI] Inline suggestions registered');

  // ── Register Diff Decorations ───────────────────────────────────
  context.subscriptions.push(diffDecorations);
  context.subscriptions.push(
    vscode.window.onDidChangeVisibleTextEditors(() => diffDecorations.onEditorChange())
  );

  // ── Register File @mention provider for chat ────────────────────
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      { scheme: 'vscode-chat-input', language: '*' },
      new FileMentionProvider(),
      '@'
    )
  );

  // ── Register Secondary Side Bar Webview View ────────────────────
  const agentViewProvider = new AgentWebViewProvider(context, () => agent);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('pulsecode.agent.main', agentViewProvider, {
      webviewOptions: { retainContextWhenHidden: true }
    })
  );
  console.log('[PulseCode AI] Panel view registered');

  // ── Register Chat Participant (@PulseCode in chat panel) ─────────
  const chatParticipant = new PulseCodeChatParticipant(agent);
  const participant = vscode.chat.createChatParticipant('pulsecode.pulse-agent', async (request, context, stream, token) => {
    await chatParticipant.handleRequest(request, context, stream, token);
  });
  participant.iconPath = vscode.Uri.file(path.join(context.extensionPath, 'resources', 'agent-icon.svg'));
  context.subscriptions.push(participant);
  console.log('[PulseCode AI] Chat participant registered');

  // ── Register Status Bar ─────────────────────────────────────────
  context.subscriptions.push(statusBar);
  statusBar.setModel(currentModel);

  // ── Register commands ───────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('pulse.openView', async () => {
          // Focus the agent panel view in the right panel
          await vscode.commands.executeCommand('pulsecode.agent.main.focus');
        }),
    vscode.commands.registerCommand('pulse.clearHistory', async () => {
      sessionDB.clearAll();
      vscode.window.showInformationMessage('PulseCode AI: History cleared');
    }),
    vscode.commands.registerCommand('pulse.createSkill', async () => {
      const name = await vscode.window.showInputBox({ prompt: 'Skill name' });
      if (name) {
        const desc = await vscode.window.showInputBox({ prompt: 'Skill description' });
        if (desc) {
          const filePath = await skillsLoader.createSkill(name, desc, currentApiKey, currentBaseURL, currentModel);
          const doc = await vscode.workspace.openTextDocument(filePath);
          await vscode.window.showTextDocument(doc);
        }
      }
    }),
    vscode.commands.registerCommand('pulse.startMcpServer', async () => {
      const port = await mcpServer.start();
      vscode.window.showInformationMessage(`PulseCode AI: MCP server running on port ${port}`);
    }),
    vscode.commands.registerCommand('pulse.stopMcpServer', async () => {
      await mcpServer.stop();
      vscode.window.showInformationMessage('PulseCode AI: MCP server stopped');
    }),
    vscode.commands.registerCommand('pulse.runTest', async () => {
      vscode.window.showInformationMessage('PulseCode AI: Run tests');
    }),
    vscode.commands.registerCommand('pulse.openSettings', async () => {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'pulse');
    }),
    vscode.commands.registerCommand('pulse.setApiKey', async () => {
      const key = await vscode.window.showInputBox({ prompt: 'Enter API key', password: true });
      if (key) {
        currentApiKey = key;
        const cfg = vscode.workspace.getConfiguration('pulse');
        await cfg.update('apiKey', key, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage('PulseCode AI: API key saved');
      }
    }),
    vscode.commands.registerCommand('pulse.setProvider', async () => {
      const providers = ['openrouter', 'nvidia', 'groq', 'bluesmind', 'custom'];
      const choice = await vscode.window.showQuickPick(providers, { placeHolder: 'Select provider' });
      if (choice) {
        process.env['PROVIDER'] = choice;
        resolveConfig();
        if (agent) {
          agent.setModel(currentModel);
          agent.setBaseURL(currentBaseURL);
          agent.setApiKey(currentApiKey);
        }
        statusBar.setModel(currentModel);
        // Notify webview of the provider change
        const wv = (globalThis as any).__pulseWebview;
        if (wv) {
          wv.webview.postMessage({
            command: 'modelUpdate',
            model: currentModel,
            provider: choice,
            baseURL: currentBaseURL,
          });
        }
        vscode.window.showInformationMessage(`PulseCode AI: Provider set to ${choice}`);
      }
    }),
    vscode.commands.registerCommand('pulse.searchSessions', async () => {
      const query = await vscode.window.showInputBox({ prompt: 'Search sessions' });
      if (query) {
        const results = sessionDB.searchSessions(query);
        if (results.length === 0) {
          vscode.window.showInformationMessage('No sessions found');
        } else {
          const items = results.map(r => ({ label: r.title, description: r.snippet, id: r.session_id }));
          const picked = await vscode.window.showQuickPick(items, { placeHolder: `${results.length} results` });
          if (picked) {
            const msgs = sessionDB.getSessionMessages(picked.id);
            vscode.window.showInformationMessage(`Session "${picked.label}": ${msgs.length} messages`);
          }
        }
      }
    }),
    vscode.commands.registerCommand('pulse.recentSessions', async () => {
      const sessions = sessionDB.getRecentSessions(10);
      if (sessions.length === 0) {
        vscode.window.showInformationMessage('No sessions yet');
      } else {
        const items = sessions.map(s => ({ label: s.title, description: s.preview, id: s.id }));
        const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Recent sessions' });
        if (picked) {
          const msgs = sessionDB.getSessionMessages(picked.id);
          vscode.window.showInformationMessage(`Session "${picked.label}": ${msgs.length} messages`);
        }
      }
    }),
    vscode.commands.registerCommand('pulse.saveFact', async () => {
      const fact = await vscode.window.showInputBox({ prompt: 'Fact to remember' });
      if (fact) {
        memorySystem.saveFact(fact);
        vscode.window.showInformationMessage('PulseCode AI: Fact saved');
      }
    }),
    vscode.commands.registerCommand('pulse.showMemory', async () => {
      const entries = memory.getAll();
      if (entries.length === 0) {
        vscode.window.showInformationMessage('No memories saved');
      } else {
        const lines = entries.map(e => `- [${e.category}] ${e.content}`);
        vscode.window.showQuickPick(lines, { placeHolder: `${entries.length} memories` });
      }
    }),
    vscode.commands.registerCommand('pulse.clearMemory', async () => {
      memorySystem.clearAll();
      vscode.window.showInformationMessage('PulseCode AI: Memory cleared');
    }),
    vscode.commands.registerCommand('pulse.setUserProfile', async () => {
      const profile = await vscode.window.showInputBox({ prompt: 'User profile / preferences' });
      if (profile) {
        memorySystem.setProfile(profile);
        vscode.window.showInformationMessage('PulseCode AI: Profile saved');
      }
    }),
    vscode.commands.registerCommand('pulse.createRules', async () => {
      await rulesManager.createDefaultRules();
    }),
    vscode.commands.registerCommand('pulse.switchMode', async () => {
      const modes = ['chat', 'code', 'plan'];
      const choice = await vscode.window.showQuickPick(modes, { placeHolder: 'Select agent mode' });
      if (choice) {
        const cfg = vscode.workspace.getConfiguration('pulse');
        await cfg.update('defaultMode', choice, vscode.ConfigurationTarget.Global);
        if (agent) agent.setMode(choice as any);
        telemetry.track('mode_switch', { mode: choice });
        vscode.window.showInformationMessage(`PulseCode AI: Mode set to ${choice}`);
      }
    }),
    vscode.commands.registerCommand('pulse.toggleInline', async () => {
      const enabled = inlineSuggestions.isEnabled();
      inlineSuggestions.setEnabled(!enabled);
      vscode.window.showInformationMessage(`PulseCode AI: Inline suggestions ${!enabled ? 'enabled' : 'disabled'}`);
    }),
    vscode.commands.registerCommand('pulse.showWelcome', async () => {
      await onboarding.showWelcome();
    }),
    vscode.commands.registerCommand('pulse.showAgentPanel', async () => {
      await vscode.commands.executeCommand('workbench.view.extension.pulsecode.agent.main');
    })
  );

  // ── Listen for configuration changes ────────────────────────────
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('pulse.model')) {
        currentModel = vscode.workspace.getConfiguration('pulse').get<string>('model') || 'openrouter/owl-alpha';
        statusBar.setModel(currentModel);
      }
      if (e.affectsConfiguration('pulse.apiKey')) {
        currentApiKey = vscode.workspace.getConfiguration('pulse').get<string>('apiKey') || '';
      }
    })
  );

  // ── Track file changes for flow state ───────────────────────────
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(e => {
      flowState.trackEdit(e.document.fileName, e.contentChanges[0]?.range.start.line || 0);
    })
  );

  // ── Show onboarding for first run ──────────────────────────────
  onboarding.checkAndShow();

  // ── Track session start
  telemetry.track('session_start', {
    model: currentModel,
    provider: process.env['PROVIDER'] || 'openrouter',
  });

  console.log('PulseCode AI Agent activated (builtin v0.3.0)');
}

export function deactivate() {
  if (mcpServer) { try { mcpServer.stop(); } catch {} }
  if (contextEngine) { try { contextEngine.dispose(); } catch {} }
  if (flowState) { try { flowState.dispose(); } catch {} }
  if (rulesManager) { try { rulesManager.dispose(); } catch {} }
  if (inlineSuggestions) { try { inlineSuggestions.dispose(); } catch {} }
  if (diffDecorations) { try { diffDecorations.dispose(); } catch {} }
  if (statusBar) { try { statusBar.dispose(); } catch {} }
  if (telemetry) { try { telemetry.dispose(); } catch {} }
  try { closeBrowser(); } catch {}
}
