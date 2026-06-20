// src/tools/change-tools.ts
// Change tracking, logging, and revert support.

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { defineTool } from '../tool-registry';

interface ChangeEntry {
  type: string;
  path: string;
  timestamp: number;
  backupPath?: string;
}

function getChangeLogDir(): string {
  const wf = vscode.workspace.workspaceFolders;
  const base = wf ? wf[0].uri.fsPath : process.cwd();
  const dir = path.join(base, '.pulse', 'change-logs');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getChangeLogFile(sessionId: string): string {
  return path.join(getChangeLogDir(), sessionId + '.json');
}

function loadChangeLog(sessionId: string): ChangeEntry[] {
  try {
    const file = getChangeLogFile(sessionId);
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch { /* ignore */ }
  return [];
}

function saveChangeLog(sessionId: string, entries: ChangeEntry[]): void {
  try { fs.writeFileSync(getChangeLogFile(sessionId), JSON.stringify(entries, null, 2)); } catch { /* ignore */ }
}

function getWorkspaceRoot(): string {
  const wf = vscode.workspace.workspaceFolders;
  if (!wf) throw new Error('No workspace folder open');
  return wf[0].uri.fsPath;
}

export const logChangeTool = defineTool(
  'log_change',
  'Log a file change for audit trail',
  {
    type: 'object',
    properties: {
      session_id: { type: 'string', description: 'Session ID (default: default)' },
      change_type: { type: 'string', description: 'Type: write_file, edit_file, delete_file' },
      path: { type: 'string', description: 'File path that was changed' },
    },
    required: ['change_type', 'path'],
  },
  async (args: Record<string, unknown>): Promise<string> => {
    const sessionId = (args.session_id as string) || 'default';
    const changeType = args.change_type as string;
    const changePath = args.path as string;
    if (!changeType || !changePath) throw new Error('log_change requires "change_type" + "path"');
    const entries = loadChangeLog(sessionId);
    entries.push({ type: changeType, path: changePath, timestamp: Date.now() });
    saveChangeLog(sessionId, entries);
    return 'Logged ' + changeType + ': ' + changePath + ' (session ' + sessionId + ': ' + entries.length + ' changes)';
  }
);

export const getChangeLogTool = defineTool(
  'get_change_log',
  'Get the change log for a session',
  {
    type: 'object',
    properties: { session_id: { type: 'string', description: 'Session ID (default: default)' } },
    required: [],
  },
  async (args: Record<string, unknown>): Promise<string> => {
    const sessionId = (args.session_id as string) || 'default';
    const entries = loadChangeLog(sessionId);
    if (entries.length === 0) return 'No changes logged.';
    return entries.map((c, i) => '[' + (i + 1) + '] ' + c.type + ': ' + c.path + ' (' + new Date(c.timestamp).toLocaleTimeString() + ')').join('\n');
  }
);

export const revertChangesTool = defineTool(
  'revert_changes',
  'Revert changes from the change log',
  {
    type: 'object',
    properties: {
      session_id: { type: 'string', description: 'Session ID (default: default)' },
      steps_to_revert: { type: 'number', description: 'Number of recent changes to revert (default: all)' },
    },
    required: [],
  },
  async (args: Record<string, unknown>): Promise<string> => {
    const sessionId = (args.session_id as string) || 'default';
    const stepsToRevert = args.steps_to_revert as number | undefined;
    const entries = loadChangeLog(sessionId);
    if (entries.length === 0) return 'No changes to revert.';
    const toRevert = stepsToRevert ? entries.slice(-stepsToRevert) : [...entries];
    const reverted: string[] = [];
    const errors: string[] = [];
    for (let i = toRevert.length - 1; i >= 0; i--) {
      const change = toRevert[i];
      try {
        if (change.type === 'write_file' || change.type === 'edit_file') {
          const backupDir = path.join(getWorkspaceRoot(), '.agent-backups');
          const backupName = change.path.replace(/[\\/]/g, '_');
          const versions = fs.existsSync(backupDir) ? fs.readdirSync(backupDir).filter((f: string) => f.startsWith(backupName)).sort() : [];
          if (versions.length > 0) {
            fs.copyFileSync(path.join(backupDir, versions[versions.length - 1]), path.join(getWorkspaceRoot(), change.path));
            reverted.push('restored ' + change.path + ' from backup');
          } else {
            reverted.push('no backup for ' + change.path + ' (skipped)');
          }
        } else {
          reverted.push('reverted ' + change.type + ': ' + change.path);
        }
      } catch (e: any) {
        errors.push(change.path + ': ' + e.message);
      }
    }
    if (stepsToRevert) {
      const remaining = entries.slice(0, entries.length - stepsToRevert);
      saveChangeLog(sessionId, remaining);
    } else {
      saveChangeLog(sessionId, []);
    }
    let summary = 'Reverted ' + reverted.length + ' changes:\n' + reverted.map(r => '  - ' + r).join('\n');
    if (errors.length > 0) summary += '\nErrors:\n' + errors.map(e => '  - ' + e).join('\n');
    return summary;
  }
);

export const clearChangeLog = defineTool(
  'clear_change_log',
  'Clear the change log for a session',
  {
    type: 'object',
    properties: { session_id: { type: 'string', description: 'Session ID (default: default)' } },
    required: [],
  },
  async (args: Record<string, unknown>): Promise<string> => {
    const sessionId = (args.session_id as string) || 'default';
    saveChangeLog(sessionId, []);
    return 'Change log cleared for session: ' + sessionId;
  }
);
