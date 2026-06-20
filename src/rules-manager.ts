// src/rules-manager.ts
// Rules File Manager — .pulserules support (like .cursorrules / .windsurfrules)
// Loads project-specific rules that guide agent behavior

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface RulesConfig {
  content: string;
  filePath: string;
  lastModified: number;
}

export class RulesManager {
  private rules: RulesConfig | null = null;
  private workspaceRoot: string = '';
  private fileWatcher: vscode.FileSystemWatcher | undefined;

  // Supported rules file names (in priority order)
  private static readonly RULES_FILES = [
    '.pulserules',
    '.pulsecode-rules',
    'PULSECODE.md',
    '.cursorrules', // Compatibility
    '.windsurfrules', // Compatibility
  ];

  constructor() {
    const ws = vscode.workspace.workspaceFolders;
    if (ws) this.workspaceRoot = ws[0].uri.fsPath;
  }

  /** Initialize: load rules + watch for changes */
  async initialize(): Promise<void> {
    if (!this.workspaceRoot) return;
    await this.loadRules();
    this.setupWatcher();
  }

  /** Find and load rules file */
  async loadRules(): Promise<void> {
    if (!this.workspaceRoot) return;

    for (const fileName of RulesManager.RULES_FILES) {
      const filePath = path.join(this.workspaceRoot, fileName);
      if (fs.existsSync(filePath)) {
        try {
          const stat = fs.statSync(filePath);
          const content = fs.readFileSync(filePath, 'utf-8');
          this.rules = { content, filePath, lastModified: stat.mtimeMs };
          console.log('[RulesManager] Loaded rules from ' + fileName);
          return;
        } catch { /* skip unreadable */ }
      }
    }

    this.rules = null;
  }

  /** Setup file watcher */
  private setupWatcher(): void {
    this.fileWatcher = vscode.workspace.createFileSystemWatcher(
      '{' + RulesManager.RULES_FILES.join(',') + '}'
    );
    this.fileWatcher.onDidCreate(() => this.loadRules());
    this.fileWatcher.onDidChange(() => this.loadRules());
    this.fileWatcher.onDidDelete(() => { this.rules = null; });
  }

  /** Get rules content for injection into system prompt */
  getRulesForPrompt(): string {
    if (!this.rules) return '';
    return '\n## Project Rules\nThe following project-specific rules have been defined. Follow them at all times:\n\n' + this.rules.content + '\n';
  }

  /** Check if rules exist */
  hasRules(): boolean { return this.rules !== null; }

  /** Get rules file path */
  getRulesPath(): string | null { return this.rules?.filePath || null; }

  /** Create a default .pulserules file */
  async createDefaultRules(): Promise<void> {
    if (!this.workspaceRoot) return;
    const filePath = path.join(this.workspaceRoot, '.pulserules');

    if (fs.existsSync(filePath)) {
      vscode.window.showWarningMessage('.pulserules already exists');
      return;
    }

    const defaultRules = `# PulseCode AI Rules
# Project-specific rules for the AI agent

## Code Style
- Use TypeScript for all new code
- Follow existing code conventions in the project
- Use meaningful variable and function names
- Add JSDoc comments for public APIs

## Architecture
- Keep files small and focused (max 300 lines)
- Use dependency injection for testability
- Prefer composition over inheritance

## Testing
- Write unit tests for all new features
- Use descriptive test names
- Aim for 80%+ code coverage

## Git
- Write clear, concise commit messages
- Use conventional commits format (feat:, fix:, docs:, etc.)
- Keep commits atomic and focused

## Security
- Never hardcode API keys or secrets
- Use environment variables for configuration
- Validate all user input
`;

    fs.writeFileSync(filePath, defaultRules, 'utf-8');
    await this.loadRules();

    // Open the file for editing
    const doc = await vscode.workspace.openTextDocument(filePath);
    await vscode.window.showTextDocument(doc);

    vscode.window.showInformationMessage('Created .pulserules — edit to customize agent behavior');
  }

  dispose(): void { this.fileWatcher?.dispose(); }
}
