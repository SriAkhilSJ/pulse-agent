// src/context-engine.ts
// Context Engine — Codebase indexer with RAG-based search
// Like Windsurf's M-Query: indexes codebase, tracks file changes, provides relevant context

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface IndexEntry {
  filePath: string;
  content: string;
  lines: string[];
  lastModified: number;
  symbols: string[];
}

export interface SearchResult {
  filePath: string;
  lineStart: number;
  lineEnd: number;
  content: string;
  score: number;
}

import { config } from './config';

export class ContextEngine {
  private index: Map<string, IndexEntry> = new Map();
  private workspaceRoot: string = '';
  private fileWatcher: vscode.FileSystemWatcher | undefined;
  private maxIndexSize = config.contextMaxFiles;

  constructor() {
    const ws = vscode.workspace.workspaceFolders;
    if (ws) this.workspaceRoot = ws[0].uri.fsPath;
  }

  async initialize(): Promise<void> {
    if (!this.workspaceRoot) { return; }
    console.log('[ContextEngine] Initializing...');
    await this.indexWorkspace();
    this.setupWatcher();
    console.log('[ContextEngine] Indexed ' + this.index.size + ' files');
  }

  async indexWorkspace(): Promise<void> {
    const files = await vscode.workspace.findFiles(
      '**/*.{ts,tsx,js,jsx,py,java,c,cpp,cs,go,rb,php,rs,md,json,yaml,yml,xml,html,css,scss,sh,bash,zsh,ps1,sql}',
      '{**/node_modules/**,**/.git/**,**/out/**,**/dist/**,**/build/**,**/.vscode/**,**/.pulse/**}'
    );
    const maxFiles = Math.min(files.length, this.maxIndexSize);
    const BATCH_SIZE = config.contextBatchSize;
    for (let i = 0; i < maxFiles; i++) {
      const file = files[i];
      try {
        // Use fs.readFileSync instead of opening a TextDocument for each file
        // Opening 50k TextDocuments would freeze VS Code
        const content = fs.readFileSync(file.fsPath, 'utf-8');
        const stat = fs.statSync(file.fsPath);
        this.indexFile(file.fsPath, content, stat.mtimeMs);
      } catch { /* skip */ }
      // Yield to event loop every BATCH_SIZE files to keep UI responsive
      if (i > 0 && i % BATCH_SIZE === 0) {
        await new Promise(r => setTimeout(r, 0));
        console.log('[ContextEngine] Indexed ' + (i + 1) + '/' + maxFiles + ' files...');
      }
    }
  }

  private indexFile(filePath: string, content: string, lastModified: number): void {
    const lines = content.split('\n');
    const symbols = this.extractSymbols(content);
    const relPath = this.workspaceRoot ? path.relative(this.workspaceRoot, filePath) : filePath;
    // Always key by absolute path for reliable lookup; store relative path in entry
    this.index.set(filePath, { filePath: relPath, content, lines, lastModified, symbols });
  }

  private extractSymbols(content: string): string[] {
    const symbols: string[] = [];
    const patterns: RegExp[] = [
      /(?:export\s+)?(?:async\s+)?function\s+(\w+)/g,
      /(?:export\s+)?class\s+(\w+)/g,
      /(?:export\s+)?const\s+(\w+)\s*=/g,
      /(?:export\s+)?interface\s+(\w+)/g,
      /(?:export\s+)?type\s+(\w+)/g,
      /(?:export\s+)?enum\s+(\w+)/g,
      /def\s+(\w+)/g,
      /fn\s+(\w+)/g,
      /func\s+(\w+)/g,
    ];
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        symbols.push(match[1]);
      }
    }
    return [...new Set(symbols)];
  }

  private setupWatcher(): void {
    // Watch only source files, not everything (avoids thousands of watchers)
    this.fileWatcher = vscode.workspace.createFileSystemWatcher(
      '**/*.{ts,tsx,js,jsx,py,java,c,cpp,cs,go,rb,php,rs,md,json,yaml,yml,xml,html,css,scss,sh,bash,zsh,ps1,sql}'
    );
    this.fileWatcher.onDidCreate(async (uri) => {
      try {
        const doc = await vscode.workspace.openTextDocument(uri);
        const stat = fs.statSync(uri.fsPath);
        this.indexFile(uri.fsPath, doc.getText(), stat.mtimeMs);
      } catch { /* skip */ }
    });
    this.fileWatcher.onDidChange(async (uri) => {
      try {
        const doc = await vscode.workspace.openTextDocument(uri);
        const stat = fs.statSync(uri.fsPath);
        this.indexFile(uri.fsPath, doc.getText(), stat.mtimeMs);
      } catch { /* skip */ }
    });
    this.fileWatcher.onDidDelete((uri) => {
      this.index.delete(uri.fsPath);
    });
  }

  search(query: string, maxResults: number = 10): SearchResult[] {
    const queryLower = query.toLowerCase();
    const queryTerms = queryLower.split(/\s+/).filter(t => t.length > 2);
    const results: SearchResult[] = [];
    const seen = new Set<string>();

    for (const [filePath, entry] of this.index) {
      // Symbol matching
      for (const symbol of entry.symbols) {
        if (queryLower.includes(symbol.toLowerCase())) {
          const key = filePath + ':symbol:' + symbol;
          if (!seen.has(key)) {
            seen.add(key);
            results.push({ filePath: entry.filePath, lineStart: 1, lineEnd: 1, content: 'Symbol: ' + symbol, score: 10 });
          }
        }
      }

      // Line-by-line content matching
      for (let i = 0; i < entry.lines.length; i++) {
        const lineLower = entry.lines[i].toLowerCase();
        let matched = false;
        for (const term of queryTerms) {
          if (lineLower.includes(term)) { matched = true; break; }
        }
        if (matched) {
          const start = Math.max(0, i - 2);
          const end = Math.min(entry.lines.length, i + 3);
          const key = filePath + ':' + start;
          if (!seen.has(key)) {
            seen.add(key);
            results.push({
              filePath: entry.filePath,
              lineStart: start + 1,
              lineEnd: end,
              content: entry.lines.slice(start, end).join('\n'),
              score: queryTerms.filter(t => lineLower.includes(t)).length * 2
            });
          }
        }
      }
    }

    return results.sort((a, b) => b.score - a.score).slice(0, maxResults);
  }

  getCurrentContext(): string {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return '';

    const filePath = editor.document.fileName;
    const relPath = this.workspaceRoot ? path.relative(this.workspaceRoot, filePath) : filePath;
    const entry = this.index.get(filePath);

    let context = '## Current File: ' + relPath + '\n';

    if (entry) {
      if (entry.symbols.length > 0) {
        context += '### Symbols: ' + entry.symbols.slice(0, 20).join(', ') + '\n';
      }
      const cursorLine = editor.selection.active.line;
      const surrounding = entry.lines.slice(Math.max(0, cursorLine - 10), cursorLine + 10);
      context += '### Around cursor (line ' + (cursorLine + 1) + '):\n' + surrounding.join('\n') + '\n';
    }

    const recentFiles = [...this.index.values()].sort((a, b) => b.lastModified - a.lastModified).slice(0, 5);
    if (recentFiles.length > 0) {
      context += '### Recently modified:\n';
      for (const f of recentFiles) {
        context += '- ' + f.filePath + ' (' + f.symbols.slice(0, 5).join(', ') + ')\n';
      }
    }

    return context;
  }

  getIndexSize(): number { return this.index.size; }
  dispose(): void { this.fileWatcher?.dispose(); }
}
