// src/flow-state.ts
// Flow State — Track user actions and adapt agent behavior (like Windsurf's Flow)
// Monitors: open files, cursor position, recent edits, build errors, test results

import * as vscode from 'vscode';

export interface UserAction {
  type: 'file_open' | 'file_edit' | 'file_save' | 'command' | 'terminal' | 'debug' | 'test';
  timestamp: number;
  details: Record<string, string>;
}

export interface FlowState {
  currentFile: string;
  cursorLine: number;
  recentEdits: Array<{ file: string; line: number; timestamp: number }>;
  openFiles: string[];
  lastBuildErrors: number;
  lastTestResults: { passed: number; failed: number } | null;
  recentActions: UserAction[];
  focusArea: string; // What the user is currently working on
}

import { config } from './config';

export class FlowStateManager {
  private state: FlowState;
  private maxActions = config.flowMaxActions;
  private disposables: vscode.Disposable[] = [];

  constructor() {
    this.state = {
      currentFile: '',
      cursorLine: 0,
      recentEdits: [],
      openFiles: [],
      lastBuildErrors: 0,
      lastTestResults: null,
      recentActions: [],
      focusArea: ''
    };
  }

  /** Initialize: setup event listeners */
  initialize(): void {
    // Track file opens
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
          this.state.currentFile = editor.document.fileName;
          this.state.cursorLine = editor.selection.active.line;
          this.addAction('file_open', { file: editor.document.fileName });
        }
      })
    );

    // Track cursor position changes
    this.disposables.push(
      vscode.window.onDidChangeTextEditorSelection((e) => {
        if (e.textEditor) {
          this.state.cursorLine = e.selections[0].active.line;
        }
      })
    );

    // Track document changes (edits)
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        for (const change of e.contentChanges) {
          this.state.recentEdits.push({
            file: e.document.fileName,
            line: change.range.start.line,
            timestamp: Date.now()
          });
        }
        // Keep only last 20 edits
        if (this.state.recentEdits.length > 20) {
          this.state.recentEdits = this.state.recentEdits.slice(-20);
        }
        this.addAction('file_edit', { file: e.document.fileName });
      })
    );

    // Track file saves
    this.disposables.push(
      vscode.workspace.onDidSaveTextDocument((doc) => {
        this.addAction('file_save', { file: doc.fileName });
        this.updateFocusArea();
      })
    );

    // Initialize open files
    this.updateOpenFiles();
  }

  /** Update the list of currently open files */
  private updateOpenFiles(): void {
    const files: string[] = [];
    for (const tab of vscode.window.tabGroups.all.flatMap(g => g.tabs)) {
      if (tab.input && (tab.input as any).uri) {
        files.push((tab.input as any).uri.fsPath);
      }
    }
    this.state.openFiles = files;
  }

  private addAction(type: UserAction['type'], details: Record<string, string>): void {
    this.state.recentActions.push({ type, timestamp: Date.now(), details });
    if (this.state.recentActions.length >= this.maxActions) {
      this.state.recentActions = this.state.recentActions.slice(-this.maxActions + 1);
    }
  }

  /** Determine what the user is currently focused on */
  private updateFocusArea(): void {
    const now = Date.now();
    const recentActions = this.state.recentActions.filter(a => now - a.timestamp < 300000); // Last 5 min

    // Count action types
    const counts: Record<string, number> = {};
    for (const action of recentActions) {
      counts[action.type] = (counts[action.type] || 0) + 1;
    }

    // Determine focus
    if (counts['test'] > 2) {
      this.state.focusArea = 'testing';
    } else if (counts['debug'] > 2) {
      this.state.focusArea = 'debugging';
    } else if (counts['file_edit'] > 5) {
      this.state.focusArea = 'coding';
    } else if (counts['file_open'] > 3) {
      this.state.focusArea = 'exploring';
    } else {
      this.state.focusArea = 'idle';
    }
  }

  /** Get current flow state for agent context */
  getFlowContext(): string {
    this.updateFocusArea();

    let context = '## Flow State\n';
    context += `Current focus: ${this.state.focusArea}\n`;
    context += `Active file: ${this.state.currentFile}\n`;
    context += `Open files: ${this.state.openFiles.length}\n`;

    if (this.state.recentEdits.length > 0) {
      context += 'Recent edits:\n';
      for (const edit of this.state.recentEdits.slice(-5)) {
        context += `- ${edit.file}:${edit.line + 1}\n`;
      }
    }

    // Suggest behavior based on focus
    context += '\n## Behavior Guidance\n';
    switch (this.state.focusArea) {
      case 'testing':
        context += 'User is focused on testing. Prioritize test-related suggestions and avoid disruptive changes.\n';
        break;
      case 'debugging':
        context += 'User is debugging. Provide targeted fixes and avoid broad refactoring.\n';
        break;
      case 'coding':
        context += 'User is actively coding. Be proactive with suggestions and completions.\n';
        break;
      case 'exploring':
        context += 'User is exploring the codebase. Provide context and navigation help.\n';
        break;
      default:
        context += 'User is idle. Wait for instructions.\n';
    }

    return context;
  }

  /** Check if user is in deep focus (should not be interrupted) */
  isInDeepFocus(): boolean {
    const now = Date.now();
    const recentEdits = this.state.recentEdits.filter(e => now - e.timestamp < 60000);
    return recentEdits.length > 10; // More than 10 edits in last minute
  }

  /** Record build errors */
  trackEdit(filePath: string, line: number): void {
    this.state.recentEdits.push({ file: filePath, line, timestamp: Date.now() });
    if (this.state.recentEdits.length > 50) {
      this.state.recentEdits.shift();
    }
    this.state.currentFile = filePath;
    this.state.cursorLine = line;
    this.addAction('file_edit', { file: filePath, line: String(line) });
  }

  recordBuildErrors(count: number): void {
    this.state.lastBuildErrors = count;
  }

  /** Record test results */
  recordTestResults(passed: number, failed: number): void {
    this.state.lastTestResults = { passed, failed };
  }

  /** Get current state */
  getState(): FlowState { return { ...this.state }; }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
