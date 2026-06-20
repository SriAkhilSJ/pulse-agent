// src/statusbar.ts
// Status Bar Integration — Shows PulseCode agent status in the bottom bar
// Like Cursor's status indicator / Windsurf's status

import * as vscode from 'vscode';

export type AgentStatus = 'idle' | 'thinking' | 'working' | 'error' | 'paused';

export class StatusBarController {
  private statusBarItem: vscode.StatusBarItem;
  private disposables: vscode.Disposable[] = [];
  private currentStatus: AgentStatus = 'idle';
  private currentModel = '';
  private tokenCount = 0;

  constructor() {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.statusBarItem.command = 'pulse.switchMode';
    this.statusBarItem.tooltip = 'PulseCode AI — Click to switch mode';
    this.updateDisplay();
    this.statusBarItem.show();
  }

  setStatus(status: AgentStatus): void {
    this.currentStatus = status;
    this.updateDisplay();
  }

  setModel(model: string): void {
    this.currentModel = model;
    this.updateDisplay();
  }

  incrementTokenCount(count: number): void {
    this.tokenCount += count;
    this.updateDisplay();
  }

  resetTokenCount(): void {
    this.tokenCount = 0;
    this.updateDisplay();
  }

  private updateDisplay(): void {
    const icon = this.getStatusIcon();
    const text = this.getStatusText();
    this.statusBarItem.text = `$(zap) ${text}`;
    this.statusBarItem.backgroundColor = this.getStatusColor();
  }

  private getStatusIcon(): string {
    switch (this.currentStatus) {
      case 'thinking': return '$(loading~spin)';
      case 'working': return '$(rocket)';
      case 'error': return '$(warning)';
      case 'paused': return '$(debug-pause)';
      default: return '$(zap)';
    }
  }

  private getStatusText(): string {
    const model = this.currentModel ? this.currentModel.split('/').pop() || '' : '';
    const tokens = this.tokenCount > 0 ? ` (${this.tokenCount})` : '';
    switch (this.currentStatus) {
      case 'thinking': return 'Thinking...';
      case 'working': return `Agent working${tokens}`;
      case 'error': return 'Error';
      case 'paused': return 'Paused';
      default: return `PulseCode${model ? ' · ' + model : ''}${tokens}`;
    }
  }

  private getStatusColor(): vscode.ThemeColor | undefined {
    switch (this.currentStatus) {
      case 'error': return new vscode.ThemeColor('statusBarItem.errorBackground');
      case 'working': return new vscode.ThemeColor('statusBarItem.prominentBackground');
      default: return undefined;
    }
  }

  dispose(): void {
    this.statusBarItem.dispose();
    for (const d of this.disposables) d.dispose();
  }
}
