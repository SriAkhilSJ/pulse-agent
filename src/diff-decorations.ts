// src/diff-decorations.ts
// Inline Diff Decorations — Shows agent edits as colored lines in the editor
// Like Cursor's inline diff / Windsurf's ghost preview

import * as vscode from 'vscode';

export interface DiffLine {
  lineNumber: number;
  type: 'add' | 'delete' | 'modify';
  content: string;
  originalContent?: string;
}

export class DiffDecorationProvider implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private addDecorationType: vscode.TextEditorDecorationType;
  private delDecorationType: vscode.TextEditorDecorationType;
  private pendingDiffs: Map<string, DiffLine[]> = new Map();
  private appliedEdits: Map<string, vscode.Range[]> = new Map();

  constructor() {
    // Create decoration types for additions and deletions
    this.addDecorationType = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: 'rgba(34, 197, 94, 0.12)',
      borderColor: 'rgba(34, 197, 94, 0.4)',
      borderWidth: '1px',
      borderStyle: 'none none none solid',
      overviewRulerColor: 'rgba(34, 197, 94, 0.6)',
      overviewRulerLane: vscode.OverviewRulerLane.Right,
      light: {
        backgroundColor: 'rgba(22, 163, 74, 0.10)',
        borderColor: 'rgba(22, 163, 74, 0.35)',
      },
      dark: {
        backgroundColor: 'rgba(34, 197, 94, 0.12)',
        borderColor: 'rgba(34, 197, 94, 0.4)',
      },
    });
    this.delDecorationType = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: 'rgba(244, 63, 94, 0.12)',
      borderColor: 'rgba(244, 63, 94, 0.4)',
      borderWidth: '1px',
      borderStyle: 'none none none solid',
      overviewRulerColor: 'rgba(244, 63, 94, 0.6)',
      overviewRulerLane: vscode.OverviewRulerLane.Right,
      light: {
        backgroundColor: 'rgba(225, 29, 72, 0.10)',
        borderColor: 'rgba(225, 29, 72, 0.35)',
      },
      dark: {
        backgroundColor: 'rgba(244, 63, 94, 0.12)',
        borderColor: 'rgba(244, 63, 94, 0.4)',
      },
    });
  }

  showDiff(uri: vscode.Uri, diffs: DiffLine[]): void {
    const key = uri.toString();
    this.pendingDiffs.set(key, diffs);
    this.applyDecorations(uri);
  }

  private applyDecorations(uri: vscode.Uri): void {
    const editor = vscode.window.visibleTextEditors.find(
      e => e.document.uri.toString() === uri.toString()
    );
    if (!editor) return;

    const key = uri.toString();
    const diffs = this.pendingDiffs.get(key);
    if (!diffs) return;

    const addRanges: vscode.Range[] = [];
    const delRanges: vscode.Range[] = [];

    for (const diff of diffs) {
      const lineNum = diff.lineNumber - 1; // 0-indexed
      if (lineNum < 0 || lineNum >= editor.document.lineCount) continue;

      const range = new vscode.Range(lineNum, 0, lineNum, 0);
      if (diff.type === 'add' || diff.type === 'modify') {
        addRanges.push(range);
      } else {
        delRanges.push(range);
      }
    }

    editor.setDecorations(this.addDecorationType, addRanges);
    editor.setDecorations(this.delDecorationType, delRanges);
    this.appliedEdits.set(key, [...addRanges, ...delRanges]);
  }

  clearDiff(uri: vscode.Uri): void {
    const key = uri.toString();
    this.pendingDiffs.delete(key);
    const editor = vscode.window.visibleTextEditors.find(
      e => e.document.uri.toString() === key
    );
    if (editor) {
      editor.setDecorations(this.addDecorationType, []);
      editor.setDecorations(this.delDecorationType, []);
    }
  }

  clearAll(): void {
    for (const uri of this.pendingDiffs.keys()) {
      this.clearDiff(vscode.Uri.parse(uri));
    }
  }

  onEditorChange(): void {
    // Re-apply decorations when visible editors change
    for (const uri of this.pendingDiffs.keys()) {
      this.applyDecorations(vscode.Uri.parse(uri));
    }
  }

  dispose(): void {
    this.addDecorationType.dispose();
    this.delDecorationType.dispose();
    for (const d of this.disposables) d.dispose();
  }
}
