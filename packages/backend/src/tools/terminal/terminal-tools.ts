// packages/backend/src/tools/terminal/terminal-tools.ts
import { execSync } from 'child_process';
import { defineTool } from '../../tool-registry.js';
import { config } from '../../config.js';

export const runTerminalTool = defineTool('run_terminal', 'Run a shell command', {
  type: 'object',
  properties: {
    command: { type: 'string', description: 'Shell command to execute' },
    cwd: { type: 'string', description: 'Working directory (optional)' },
    timeout_ms: { type: 'number', description: 'Timeout in ms (optional)' },
  },
  required: ['command'],
}, async (args) => {
  const cmd = String(args.command);
  const cwd = args.cwd ? String(args.cwd) : process.cwd();
  const timeout = args.timeout_ms ? Number(args.timeout_ms) : config.terminalTimeoutMs;
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
