// packages/backend/src/context/indexer.ts
// Context Engine — Codebase indexer with RAG-based search (standalone, no VS Code deps)

import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config.js';

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

export class ContextEngine {
  private index: Map<string, IndexEntry> = new Map();
  private workspaceRoot: string = '';
  private maxIndexSize = config.contextMaxFiles;

  constructor(workspaceRoot?: string) {
    this.workspaceRoot = workspaceRoot || process.cwd();
  }

  async initialize(): Promise<void> {
    if (!this.workspaceRoot) return;
    console.log('[ContextEngine] Initializing...');
    await this.indexWorkspace();
    console.log('[ContextEngine] Indexed ' + this.index.size + ' files');
  }

  async indexWorkspace(): Promise<void> {
    const files = this.findFiles();
    const maxFiles = Math.min(files.length, this.maxIndexSize);
    const BATCH_SIZE = config.contextBatchSize;
    for (let i = 0; i < maxFiles; i++) {
      const filePath = files[i];
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const stat = fs.statSync(filePath);
        this.indexFile(filePath, content, stat.mtimeMs);
      } catch { /* skip */ }
      if (i > 0 && i % BATCH_SIZE === 0) {
        await new Promise(r => setTimeout(r, 0));
      }
    }
  }

  private findFiles(): string[] {
    const results: string[] = [];
    const exts = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.c', '.cpp', '.cs', '.go', '.rb', '.php', '.rs', '.md', '.json', '.yaml', '.yml', '.xml', '.html', '.css', '.scss', '.sh', '.bash', '.zsh', '.ps1', '.sql']);
    const skipDirs = new Set(['node_modules', '.git', 'out', 'dist', 'build', '.vscode', '.pulse']);
    const walk = (dir: string) => {
      if (results.length >= this.maxIndexSize) return;
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (results.length >= this.maxIndexSize) return;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!skipDirs.has(entry.name)) walk(full);
        } else if (exts.has(path.extname(entry.name))) {
          results.push(full);
        }
      }
    };
    walk(this.workspaceRoot);
    return results;
  }

  private indexFile(filePath: string, content: string, lastModified: number): void {
    const lines = content.split('\n');
    const symbols = this.extractSymbols(content);
    const relPath = this.workspaceRoot ? path.relative(this.workspaceRoot, filePath) : filePath;
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

  search(query: string, maxResults: number = 10): SearchResult[] {
    const queryLower = query.toLowerCase();
    const queryTerms = queryLower.split(/\s+/).filter(t => t.length > 2);
    const results: SearchResult[] = [];
    const seen = new Set<string>();

    for (const [filePath, entry] of this.index) {
      for (const symbol of entry.symbols) {
        if (queryLower.includes(symbol.toLowerCase())) {
          const key = filePath + ':symbol:' + symbol;
          if (!seen.has(key)) {
            seen.add(key);
            results.push({ filePath: entry.filePath, lineStart: 1, lineEnd: 1, content: 'Symbol: ' + symbol, score: 10 });
          }
        }
      }
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
    const recentFiles = [...this.index.values()].sort((a, b) => b.lastModified - a.lastModified).slice(0, 5);
    if (recentFiles.length === 0) return '';
    let context = '## Workspace Context\n';
    context += '### Recently modified:\n';
    for (const f of recentFiles) {
      context += '- ' + f.filePath + ' (' + f.symbols.slice(0, 5).join(', ') + ')\n';
    }
    return context;
  }

  getIndexSize(): number { return this.index.size; }
}
