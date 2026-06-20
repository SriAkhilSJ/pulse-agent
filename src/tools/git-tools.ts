// src/tools/git-tools.ts
// Git operations: diff, commit, branch, status, log, stash

import * as vscode from 'vscode';
import { execSync } from 'child_process';
import { defineTool } from '../tool-registry';
import { config } from '../config';

function getWorkspaceRoot(): string {
  const wf = vscode.workspace.workspaceFolders;
  if (!wf) throw new Error('No workspace folder open');
  return wf[0].uri.fsPath;
}

function gitCmd(cmd: string): string {
  try {
    return execSync(`git ${cmd}`, {
      cwd: getWorkspaceRoot(), encoding: 'utf-8', timeout: config.terminalTimeoutMs,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    }).trim();
  } catch (e: any) {
    const msg = e.message ? e.message.split('\n')[0] : String(e);
    const stdout = e.stdout ? e.stdout.toString().trim() : '';
    return 'Error: ' + msg + (stdout ? '\n' + stdout : '');
  }
}

export const gitStatusTool = defineTool(
  'git_status',
  'Get git working tree status',
  { type: 'object', properties: {}, required: [] },
  async (): Promise<string> => {
    const status = gitCmd('status --porcelain');
    if (!status) return 'Working tree clean — no changes';
    const lines = status.split('\n');
    const staged = lines.filter(l => l.startsWith('A ') || l.startsWith('M ') || l.startsWith('D '));
    const unstaged = lines.filter(l => l.startsWith(' M') || l.startsWith(' D') || l.startsWith('??'));
    let result = 'Git Status:\n';
    if (staged.length) result += '\nStaged:\n' + staged.map(l => '  ' + l).join('\n');
    if (unstaged.length) result += '\nUnstaged/Untracked:\n' + unstaged.map(l => '  ' + l).join('\n');
    return result;
  }
);

export const gitDiffTool = defineTool(
  'git_diff',
  'Get git diff (staged or unstaged)',
  {
    type: 'object',
    properties: {
      staged: { type: 'boolean', description: 'Show staged changes only' },
      file: { type: 'string', description: 'Specific file path (optional)' },
    },
    required: [],
  },
  async (args: Record<string, unknown>): Promise<string> => {
    const staged = args.staged ? '--staged ' : '';
    const file = args.file ? ' -- ' + args.file : '';
    return gitCmd(`diff ${staged}${file}`) || '(no diff)';
  }
);

export const gitLogTool = defineTool(
  'git_log',
  'Get git commit log',
  {
    type: 'object',
    properties: {
      count: { type: 'number', description: 'Number of commits (default: 10)' },
      oneline: { type: 'boolean', description: 'Show one-line format' },
    },
    required: [],
  },
  async (args: Record<string, unknown>): Promise<string> => {
    const count = (args.count as number) || 10;
    const format = args.oneline ? '--oneline' : '--format="%h %s (%cr) <%an>"';
    return gitCmd(`log -${count} ${format}`);
  }
);

export const gitBranchTool = defineTool(
  'git_branch',
  'List, create, or switch git branches',
  {
    type: 'object',
    properties: {
      create: { type: 'string', description: 'Create a new branch with this name' },
      delete: { type: 'string', description: 'Delete a branch' },
      checkout: { type: 'string', description: 'Switch to a branch' },
    },
    required: [],
  },
  async (args: Record<string, unknown>): Promise<string> => {
    if (args.create) return gitCmd(`checkout -b ${args.create}`) || `Created branch: ${args.create}`;
    if (args.delete) return gitCmd(`branch -d ${args.delete}`) || `Deleted branch: ${args.delete}`;
    if (args.checkout) return gitCmd(`checkout ${args.checkout}`) || `Switched to: ${args.checkout}`;
    const branches = gitCmd('branch -a --format="%(refname:short) %(upstream:short)"');
    const current = gitCmd('branch --show-current');
    return `Current: ${current}\n\nBranches:\n${branches.split('\n').map(l => '  ' + l).join('\n')}`;
  }
);

export const gitCommitTool = defineTool(
  'git_commit',
  'Stage all changes and create a git commit',
  {
    type: 'object',
    properties: { message: { type: 'string', description: 'Commit message' } },
    required: ['message'],
  },
  async (args: Record<string, unknown>): Promise<string> => {
    const message = args.message as string;
    if (!message) throw new Error('commit requires "message"');
    gitCmd('add -A');
    return gitCmd(`commit -m "${message.replace(/"/g, '\\"')}"`) || 'Committed';
  }
);

export const gitStashTool = defineTool(
  'git_stash',
  'Stash changes (push/pop/list)',
  {
    type: 'object',
    properties: {
      action: { type: 'string', description: 'Action: push, pop, list' },
      message: { type: 'string', description: 'Stash message (for push)' },
    },
    required: ['action'],
  },
  async (args: Record<string, unknown>): Promise<string> => {
    const action = (args.action as string) || 'push';
    if (action === 'push') {
      const msg = args.message ? `-m "${args.message}"` : '';
      return gitCmd(`stash push ${msg}`) || 'Stashed';
    }
    if (action === 'pop') return gitCmd('stash pop') || 'Popped stash';
    if (action === 'list') return gitCmd('stash list') || '(no stashes)';
    throw new Error('stash requires action: push/pop/list');
  }
);
