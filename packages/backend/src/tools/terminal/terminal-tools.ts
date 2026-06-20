// packages/backend/src/tools/terminal/terminal-tools.ts
// Terminal tools — now with Docker sandbox integration

import { execSync } from 'child_process';
import { defineTool } from '../../tool-registry.js';
import { config } from '../../config.js';
import { DockerSandbox } from '../../sandbox/docker-sandbox.js';
import { getDefaultSandboxConfig } from '@pulse-ide/shared';

// Singleton sandbox instance
let sandbox: DockerSandbox | null = null;

function getSandbox(): DockerSandbox {
  if (!sandbox) {
    sandbox = new DockerSandbox(getDefaultSandboxConfig());
  }
  return sandbox;
}

export const runTerminalTool = defineTool('run_terminal', 'Run a shell command (sandboxed)', {
  type: 'object',
  properties: {
    command: { type: 'string', description: 'Shell command to execute' },
    cwd: { type: 'string', description: 'Working directory (optional)' },
    timeout_ms: { type: 'number', description: 'Timeout in ms (optional)' },
    use_sandbox: { type: 'boolean', description: 'Run in Docker sandbox (default: true)' },
  },
  required: ['command'],
}, async (args: Record<string, unknown>) => {
  const cmd = String(args.command);
  const cwd = args.cwd ? String(args.cwd) : process.cwd();
  const timeout = args.timeout_ms ? Number(args.timeout_ms) : config.terminalTimeoutMs;
  const useSandbox = args.use_sandbox !== false; // default true

  if (useSandbox) {
    const sbx = getSandbox();
    const result = await sbx.execute(cmd, cwd);

    if (result.blocked) {
      return `[BLOCKED] ${result.blockReason}\n`;
    }

    if (result.killed) {
      return `[TIMEOUT] Command timed out after ${timeout}ms\n${result.stdout}\n`;
    }

    if (result.exitCode !== 0) {
      return `${result.stdout}\n[ERROR] Exit code ${result.exitCode}: ${result.stderr}\n`;
    }

    return result.stdout || result.stderr || '(no output)';
  }

  // Fallback: direct host execution (not recommended)
  try {
    const output = execSync(cmd, { cwd, timeout, encoding: 'utf-8', maxBuffer: 1024 * 1024 });
    return output;
  } catch (err: any) {
    if (err.stdout) return err.stdout + '\n[ERROR]\n' + (err.stderr || '');
    throw new Error(`Command failed: ${err.message}`);
  }
});

export const detectTerminalProfile = defineTool('detect_terminal_profile', 'Detect the current shell', {
  type: 'object', properties: {}, required: [],
}, async () => {
  const shell = process.env.SHELL || process.env.ComSpec || 'unknown';
  return `Shell: ${shell}`;
});

export const getShellInfo = defineTool('get_shell_info', 'Get shell information', {
  type: 'object', properties: {}, required: [],
}, async () => {
  return JSON.stringify({
    shell: process.env.SHELL || process.env.ComSpec || 'unknown',
    platform: process.platform,
    cwd: process.cwd(),
  });
});
