// src/multi-file-edit.ts
// Multi-File Edit — Diff preview for agent changes (like Cursor's Composer / Windsurf's Cascade)
// Shows a unified diff before applying changes

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface FileChange {
  filePath: string;
  originalContent: string;
  newContent: string;
  description: string;
}

export interface EditPlan {
  id: string;
  description: string;
  changes: FileChange[];
  status: 'pending' | 'applying' | 'applied' | 'rejected';
}

export class MultiFileEditManager {
  private pendingPlan: EditPlan | null = null;
  private outputChannel: vscode.OutputChannel;

  constructor() {
    this.outputChannel = vscode.window.createOutputChannel('PulseCode Multi-Edit');
  }

  createPlan(description: string, changes: FileChange[]): EditPlan {
    const plan: EditPlan = { id: 'edit-' + Date.now(), description, changes, status: 'pending' };
    this.pendingPlan = plan;
    return plan;
  }

  async showDiffPreview(): Promise<boolean> {
    if (!this.pendingPlan || this.pendingPlan.changes.length === 0) {
      vscode.window.showWarningMessage('No pending edits to preview');
      return false;
    }
    const plan = this.pendingPlan;
    const diffContent = this.generateUnifiedDiff(plan);
    const doc = await vscode.workspace.openTextDocument({ content: diffContent, language: 'diff' });
    await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside });
    const action = await vscode.window.showInformationMessage(
      'Multi-File Edit: ' + plan.changes.length + ' file(s) will be modified',
      'Apply All', 'Reject', 'View Details'
    );
    if (action === 'Apply All') return await this.applyPlan();
    if (action === 'View Details') { this.showDetails(plan); return false; }
    return false;
  }

  private generateUnifiedDiff(plan: EditPlan): string {
    let diff = '# Multi-File Edit Plan\n';
    diff += '# ' + plan.description + '\n';
    diff += '# ' + plan.changes.length + ' file(s) modified\n\n';
    for (const change of plan.changes) {
      diff += '--- a/' + change.filePath + '\n';
      diff += '+++ b/' + change.filePath + '\n';
      diff += '@@ ' + change.description + ' @@\n';
      const ol = change.originalContent.split('\n');
      const nl = change.newContent.split('\n');
      const max = Math.max(ol.length, nl.length);
      for (let i = 0; i < max; i++) {
        const old = ol[i], nw = nl[i];
        if (old === nw) diff += ' ' + old + '\n';
        else {
          if (old !== undefined) diff += '-' + old + '\n';
          if (nw !== undefined) diff += '+' + nw + '\n';
        }
      }
      diff += '\n';
    }
    return diff;
  }

  async applyPlan(): Promise<boolean> {
    if (!this.pendingPlan) return false;
    const plan = this.pendingPlan;
    plan.status = 'applying';
    let applied = 0, failed = 0;
    for (const change of plan.changes) {
      try {
        const fullPath = path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '', change.filePath);
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(fullPath, change.newContent, 'utf-8');
        applied++;
        this.outputChannel.appendLine('✓ Applied: ' + change.filePath);
      } catch (err) {
        failed++;
        this.outputChannel.appendLine('✗ Failed: ' + change.filePath + ' — ' + err);
      }
    }
    plan.status = failed === 0 ? 'applied' : 'rejected';
    vscode.window.showInformationMessage('Multi-File Edit: ' + applied + ' applied, ' + failed + ' failed');
    this.pendingPlan = null;
    return failed === 0;
  }

  private showDetails(plan: EditPlan): void {
    this.outputChannel.clear();
    this.outputChannel.appendLine('=== Multi-File Edit Plan ===');
    this.outputChannel.appendLine('Description: ' + plan.description);
    this.outputChannel.appendLine('Files: ' + plan.changes.length);
    this.outputChannel.appendLine('');
    for (const change of plan.changes) {
      this.outputChannel.appendLine('--- ' + change.filePath + ' ---');
      this.outputChannel.appendLine('  ' + change.description);
      this.outputChannel.appendLine('  Original: ' + change.originalContent.length + ' chars');
      this.outputChannel.appendLine('  New:      ' + change.newContent.length + ' chars');
      this.outputChannel.appendLine('');
    }
    this.outputChannel.show();
  }

  getPendingPlan(): EditPlan | null { return this.pendingPlan; }
  clearPlan(): void { this.pendingPlan = null; }
  dispose(): void { this.outputChannel.dispose(); }
}
