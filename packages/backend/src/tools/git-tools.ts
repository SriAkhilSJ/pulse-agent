// packages/backend/src/tools/git-tools.ts
import { execSync } from 'child_process';
import { defineTool } from '../tool-registry.js';

function gitCmd(args: Record<string, unknown>, subcmd: string): string {
  const cwd = args.cwd ? String(args.cwd) : process.cwd();
  try {
    return execSync(`git ${subcmd}`, { cwd, encoding: 'utf-8', timeout: 10000 });
  } catch (err: any) {
    return err.stderr || err.message;
  }
}

export const gitStatusTool = defineTool('git_status', 'Git status', {
  type: 'object', properties: { cwd: { type: 'string' } }, required: [],
}, (args) => Promise.resolve(gitCmd(args, 'status')));

export const gitDiffTool = defineTool('git_diff', 'Git diff', {
  type: 'object', properties: { cwd: { type: 'string' } }, required: [],
}, (args) => Promise.resolve(gitCmd(args, 'diff')));

export const gitLogTool = defineTool('git_log', 'Git log (last 10 commits)', {
  type: 'object', properties: { cwd: { type: 'string' } }, required: [],
}, (args) => Promise.resolve(gitCmd(args, 'log --oneline -10')));

export const gitBranchTool = defineTool('git_branch', 'Git branch list', {
  type: 'object', properties: { cwd: { type: 'string' } }, required: [],
}, (args) => Promise.resolve(gitCmd(args, 'branch -a')));

export const gitCommitTool = defineTool('git_commit', 'Git commit', {
  type: 'object', properties: { message: { type: 'string' }, cwd: { type: 'string' } },
  required: ['message'],
}, (args) => Promise.resolve(gitCmd(args, `commit -m "${String(args.message).replace(/"/g, '\\"')}"`)));

export const gitStashTool = defineTool('git_stash', 'Git stash', {
  type: 'object', properties: { cwd: { type: 'string' } }, required: [],
}, (args) => Promise.resolve(gitCmd(args, 'stash')));
