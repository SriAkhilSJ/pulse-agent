// src/tools/file-tools.ts
// File and directory operations with backup, approval, and caching.

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { defineTool } from '../tool-registry';
import { config } from '../config';

// Simple in-memory cache for file reads (30 second TTL)
const readCache = new Map<string, { content: string; timestamp: number }>();

const CACHE_TTL = config.fileCacheTtlMs;

function getWorkspaceRoot(): string {
  const wf = vscode.workspace.workspaceFolders;
  if (!wf) {
    return process.cwd();
  }
  return wf[0].uri.fsPath;
}

function resolvePath(p: string): string {
  return path.resolve(getWorkspaceRoot(), p);
}

export const readFileTool = defineTool(
  'read_file',
  'Read the contents of a file',
  {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the file to read (relative or absolute)' },
    },
    required: ['path'],
  },
  async (args: Record<string, unknown>): Promise<string> => {
    const p = args.path as string;
    if (!p) throw new Error('read_file requires "path"');
    const fp = resolvePath(p);
    const now = Date.now();
    const cached = readCache.get(fp);
    if (cached && now - cached.timestamp < CACHE_TTL) {
      return cached.content;
    }
    const content = fs.readFileSync(fp, 'utf-8');
    readCache.set(fp, { content, timestamp: now });
    return content;
  }
);

export const writeFileTool = defineTool(
  'write_file',
  'Write content to a file, creating it if it does not exist',
  {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the file to write' },
      content: { type: 'string', description: 'Content to write to the file' },
    },
    required: ['path', 'content'],
  },
  async (args: Record<string, unknown>): Promise<string> => {
    const p = args.path as string, c = args.content as string;
    if (!p || c == null) throw new Error('write_file requires "path" + "content"');
    const fp = resolvePath(p);
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, c, 'utf-8');
    readCache.delete(fp);
    return 'Written ' + c.length + ' bytes to ' + p;
  }
);

export const listFilesTool = defineTool(
  'list_files',
  'List files and directories in a given path',
  {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Directory path to list (default: current directory)' },
    },
    required: [],
  },
  async (args: Record<string, unknown>): Promise<string> => {
    const dir = (args.path as string) || '.';
    const entries = fs.readdirSync(resolvePath(dir), { withFileTypes: true });
    return entries.map((e: fs.Dirent) => (e.isDirectory() ? 'DIR:' : 'FILE:') + e.name).join('\n');
  }
);

export const getCurrentFileTool = defineTool(
  'get_current_file',
  'Get the contents of the currently active file in the editor',
  { type: 'object', properties: {}, required: [] },
  async (): Promise<string> => {
    const ed = vscode.window.activeTextEditor;
    if (!ed) throw new Error('No file open');
    return 'File: ' + ed.document.fileName + '\n\n' + ed.document.getText();
  }
);

export const editFileTool = defineTool(
  'edit_file',
  'Edit a file by replacing exact text',
  {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the file to edit' },
      old_text: { type: 'string', description: 'Exact text to find and replace' },
      new_text: { type: 'string', description: 'Replacement text' },
    },
    required: ['path', 'old_text', 'new_text'],
  },
  async (args: Record<string, unknown>): Promise<string> => {
    const p = args.path as string, old = args.old_text as string, nw = args.new_text as string;
    if (!p || old == null || nw === undefined) throw new Error('edit_file requires "path" + "old_text" + "new_text"');
    const fp = resolvePath(p);
    const content = fs.readFileSync(fp, 'utf-8');
    if (!content.includes(old)) return 'Text not found in ' + p;
    const occurrences = content.split(old).length - 1;
    if (occurrences > 1) return 'Text appears ' + occurrences + ' times in ' + p + '. Provide more surrounding context to make it unique.';
    fs.writeFileSync(fp, content.replace(old, nw), 'utf-8');
    readCache.delete(fp);
    return 'Edited ' + p;
  }
);

export const deleteFileTool = defineTool(
  'delete_file',
  'Delete a file',
  {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the file to delete' },
    },
    required: ['path'],
  },
  async (args: Record<string, unknown>): Promise<string> => {
    const p = args.path as string;
    if (!p) throw new Error('delete_file requires "path"');
    const fp = resolvePath(p);
    if (!fs.existsSync(fp)) return 'Not found: ' + p;
    fs.unlinkSync(fp);
    readCache.delete(fp);
    return 'Deleted ' + p;
  }
);

export const searchCodeTool = defineTool(
  'search_code',
  'Search for a pattern in code files',
  {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Search pattern (regex or literal)' },
      path: { type: 'string', description: 'Directory to search in (default: src)' },
    },
    required: ['pattern'],
  },
  async (args: Record<string, unknown>): Promise<string> => {
    const pattern = args.pattern as string;
    const searchPath = (args.path as string) || 'src';
    if (!pattern) throw new Error('search_code requires "pattern"');
    const fp = resolvePath(searchPath);
    if (!fs.existsSync(fp)) return 'Path not found: ' + searchPath;
    let regex: RegExp;
    let regexWasInvalid = false;
    try { regex = new RegExp(pattern, 'i'); }
    catch { regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'); regexWasInvalid = true; }
    const results: string[] = [];
    const MAX_DEPTH = 10;
    const MAX_FILES = 500;
    let filesScanned = 0;
    function searchDir(dir: string, depth: number): void {
      if (depth > MAX_DEPTH || filesScanned >= MAX_FILES) return;
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { searchDir(full, depth + 1); continue; }
        if (!entry.isFile() || !entry.name.match(/\.(ts|tsx|js|jsx|json|css|scss|html|md|py|java|c|cpp|cs|go|rb|php|rs|vue|svelte|xml|yaml|yml|sh|bash|zsh|ps1|sql|txt|env|toml)$/i)) continue;
        filesScanned++;
        try {
          const content = fs.readFileSync(full, 'utf-8');
          content.split('\n').forEach((line: string, idx: number) => {
            if (regex.test(line)) {
              const rel = path.relative(getWorkspaceRoot(), full);
              results.push('  ' + rel + ':' + (idx + 1) + ' -> ' + line.trim().substring(0, 80));
            }
          });
        } catch { /* skip */ }
      }
    }
    searchDir(fp, 0);
    if (results.length === 0) return 'No matches for "' + pattern + '" in ' + searchPath;
    const uniqueFiles = new Set<string>();
    results.forEach(r => { const file = r.split(':')[0]?.trim(); if (file) uniqueFiles.add(file); });
    const shown = results.slice(0, 20);
    const more = results.length > 20 ? '\n  ... +' + (results.length - 20) + ' more' : '';
    const warning = regexWasInvalid ? '\n[Warning: Invalid regex — searched as literal text instead]' : '';
    return 'Found ' + results.length + ' matches for "' + pattern + '" in ' + uniqueFiles.size + ' files:' + warning + '\n' + shown.join('\n') + more;
  }
);

export const updateExtensionCodeTool = defineTool(
  'update_extension_code',
  'Update a file in the src/ directory with new content',
  {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the file (must be under src/)' },
      content: { type: 'string', description: 'New file content' },
    },
    required: ['path', 'content'],
  },
  async (args: Record<string, unknown>): Promise<string> => {
    const fp = args.path as string, content = args.content as string;
    if (!fp || content === undefined) throw new Error('update_extension_code requires "path" + "content"');
    const fullPath = resolvePath(fp);
    const srcPath = resolvePath('src');
    // Security: ensure resolved path is actually under src/
    const relativeToSrc = path.relative(srcPath, fullPath);
    if (relativeToSrc.startsWith('..') || path.isAbsolute(relativeToSrc)) {
      return 'Security: path resolves outside src/: ' + fp;
    }
    const backupDir = resolvePath('.agent-backups');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
    const backupName = fp.replace(/[\\/]/g, '_');
    const versions = fs.readdirSync(backupDir).filter((f: string) => f.startsWith(backupName)).sort();
    while (versions.length >= 5) fs.unlinkSync(path.join(backupDir, versions.shift()!));
    if (fs.existsSync(fullPath)) {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      fs.copyFileSync(fullPath, path.join(backupDir, backupName + '_' + ts + '.bak'));
    }
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, 'utf-8');
    const lines = content.split('\n').length;
    return 'Updated ' + fp + ' (' + lines + ' lines). Backup saved. requiresReload: true';
  }
);

export const rollbackFileTool = defineTool(
  'rollback_file',
  'Roll back a file to its last backup',
  {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the file to roll back' },
    },
    required: ['path'],
  },
  async (args: Record<string, unknown>): Promise<string> => {
    const fp = args.path as string;
    if (!fp) throw new Error('rollback_file requires "path"');
    const backupDir = resolvePath('.agent-backups');
    const backupName = fp.replace(/[\\/]/g, '_');
    const versions = fs.existsSync(backupDir) ? fs.readdirSync(backupDir).filter((f: string) => f.startsWith(backupName)).sort() : [];
    if (versions.length === 0) return 'No backup found for ' + fp;
    fs.copyFileSync(path.join(backupDir, versions[versions.length - 1]), resolvePath(fp));
    return 'Rolled back ' + fp + ' from backup (' + versions[versions.length - 1] + ')';
  }
);

export function clearReadCache(): void {
  readCache.clear();
}
