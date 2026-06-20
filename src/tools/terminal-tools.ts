// src/tools/terminal-tools.ts
// Terminal command execution using VS Code's integrated terminal profile.
// Uses async exec so it doesn't block the event loop during parallel tool execution.

import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import { defineTool } from '../tool-registry';
import { config } from '../config';

const execAsync = promisify(exec);

// ── Detected terminal profile (set once at extension activate) ────
let detectedShell: string = 'bash';
let detectedShellPath: string = 'bash';
let detectedShellArgs: string[] = ['-c'];

/** Check if a command exists on PATH */
function commandExists(cmd: string): boolean {
  try {
    const safeCmd = cmd.replace(/[&|;`$(){}[\]\\]/g, '');
    if (safeCmd !== cmd) return false;
    require('child_process').execSync('where.exe ' + safeCmd + ' 2>nul', { encoding: 'utf-8' });
    return true;
  } catch {
    return false;
  }
}

/** Find the best available PowerShell */
function findPowerShell(): { path: string; args: string[] } | null {
  if (commandExists('pwsh.exe')) {
    return { path: 'pwsh.exe', args: ['-NoProfile', '-Command'] };
  }
  if (commandExists('powershell.exe')) {
    return { path: 'powershell.exe', args: ['-NoProfile', '-Command'] };
  }
  return null;
}

/**
 * Detect the user's default VS Code terminal profile.
 * Called once from extension.ts activate().
 */
export const detectTerminalProfile = defineTool(
  'detect_terminal_profile',
  'Detect the current VS Code terminal profile',
  { type: 'object', properties: {}, required: [] },
  async (): Promise<string> => {
    try {
      const cfg = vscode.workspace.getConfiguration('terminal.integrated');
      const platform = process.platform;
      const profileKey = 'defaultProfile.' + platform;
      const profileName = cfg.get<string>(profileKey, '');
      if (profileName) {
        const profilesKey = 'profiles.' + platform;
        const profiles = cfg.get<Record<string, any>>(profilesKey, {});
        const profile = profiles[profileName];
        if (profile && profile.path) {
          detectedShellPath = profile.path;
          detectedShellArgs = profile.args || [];
          detectedShell = profileName;
          return profileName + ' (' + profile.path + ')';
        }
        detectedShell = profileName;
        return profileName;
      }
      if (platform === 'win32') {
        const ps = findPowerShell();
        if (ps) {
          detectedShell = ps.path === 'pwsh.exe' ? 'PowerShell' : 'PowerShell 5';
          detectedShellPath = ps.path;
          detectedShellArgs = ps.args;
          return detectedShell + ' (' + ps.path + ')';
        }
        detectedShell = 'Git Bash';
        detectedShellPath = 'bash';
        detectedShellArgs = ['-c'];
        return 'Git Bash (bash)';
      }
      detectedShell = process.env.SHELL || 'bash';
      detectedShellPath = detectedShell;
      detectedShellArgs = ['-c'];
      return detectedShell + ' (from $SHELL)';
    } catch (err) {
      return 'bash (fallback)';
    }
  }
);

/**
 * Build the shell invocation command based on detected profile.
 */
function buildShellCommand(): string {
  const platform = process.platform;
  if (platform === 'win32') {
    const shellLower = detectedShell.toLowerCase();
    const pathLower = detectedShellPath.toLowerCase();
    if (shellLower.includes('powershell') || shellLower.includes('pwsh') || pathLower.includes('pwsh') || pathLower.includes('powershell')) {
      const ps = findPowerShell();
      if (ps) return ps.path + ' ' + ps.args.join(' ');
      return 'bash -c';
    }
    if (shellLower.includes('command prompt') || shellLower.includes('cmd') || pathLower.includes('cmd.exe')) {
      return 'cmd.exe /c';
    }
    if (shellLower.includes('wsl') || pathLower.includes('wsl')) {
      return 'wsl.exe -e bash -c';
    }
    if (shellLower.includes('git') || shellLower.includes('bash') || pathLower.includes('git') || pathLower.includes('msys')) {
      return 'bash -c';
    }
    return 'pwsh.exe -NoProfile -Command';
  }
  return detectedShellPath + ' -c';
}

/**
 * Execute a command using the detected VS Code terminal shell.
 */
export const runTerminalTool = defineTool(
  'run_terminal',
  'Run a command in the terminal',
  {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Command to execute' },
      timeout: { type: 'number', description: 'Timeout in ms (optional, default 60000)' },
    },
    required: ['command'],
  },
  async (args: Record<string, unknown>): Promise<string> => {
    const cmd = args.command as string;
    if (!cmd) throw new Error('run_terminal requires "command"');
    const timeout = (typeof args.timeout === 'number' && args.timeout > 0) ? args.timeout : config.terminalTimeoutMs;
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
    const shellCmd = buildShellCommand();
    const escapedCmd = cmd.replace(/"/g, '\\"').replace(/'/g, "\\'").replace(/\$/g, '\\$').replace(/`/g, '\\`');
    const fullCmd = shellCmd + ' "' + escapedCmd + '"';
    try {
      const { stdout } = await execAsync(fullCmd, {
        cwd: workspaceRoot, timeout, encoding: 'utf-8',
        env: { ...process.env, MSYS: 'winsymlinks:native', CHERE_INVOKING: '1' },
        maxBuffer: 10 * 1024 * 1024,
      });
      return stdout || '(no output)';
    } catch (e: unknown) {
      const err = e as any;
      const msg = err.message ? err.message.split('\n')[0] : String(err);
      const stdout = err.stdout ? err.stdout.toString().trim() : '';
      const stderr = err.stderr ? err.stderr.toString().trim() : '';
      return 'Error: ' + msg + (stdout ? '\nStdout: ' + stdout : '') + (stderr ? '\nStderr: ' + stderr : '');
    }
  }
);

/**
 * Get the detected shell info for the agent's system prompt.
 */
export const getShellInfo = defineTool(
  'get_shell_info',
  'Get information about the current shell',
  { type: 'object', properties: {}, required: [] },
  async (): Promise<string> => {
    return JSON.stringify({
      name: detectedShell,
      path: detectedShellPath,
      args: detectedShellArgs,
      platform: process.platform,
    });
  }
);
