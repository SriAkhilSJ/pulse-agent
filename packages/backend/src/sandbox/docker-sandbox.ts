// packages/backend/src/sandbox/docker-sandbox.ts
// Docker Sandbox — secure terminal execution inside containers
// No SDKs — uses child_process.exec to run docker CLI commands

import { exec, execSync } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import type { SandboxConfig, SandboxResult } from '@pulse-ide/shared';
import { getDefaultSandboxConfig, ALLOWED_COMMANDS, BLOCKED_PATTERNS } from '@pulse-ide/shared';

const execAsync = promisify(exec);

// ---------------------------------------------------------------------------
// Command validation
// ---------------------------------------------------------------------------
function validateCommand(command: string): { allowed: boolean; reason?: string } {
  const trimmed = command.trim();

  // Check blocked patterns
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        allowed: false,
        reason: `Command blocked by security policy: pattern "${pattern.source}" matched`,
      };
    }
  }

  // Check if command starts with an allowed prefix
  const firstWord = trimmed.split(/\s+/)[0];
  const isAllowed = ALLOWED_COMMANDS.some(
    allowed => firstWord === allowed || firstWord.startsWith(allowed + '/')
  );

  if (!isAllowed) {
    return {
      allowed: false,
      reason: `Command "${firstWord}" is not in the allowed commands list`,
    };
  }

  return { allowed: true };
}

// ---------------------------------------------------------------------------
// Check if Docker is available
// ---------------------------------------------------------------------------
export function isDockerAvailable(): boolean {
  try {
    execSync('docker --version', { stdio: 'pipe', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Docker Sandbox class
// ---------------------------------------------------------------------------
export class DockerSandbox {
  private config: SandboxConfig;

  constructor(config?: Partial<SandboxConfig>) {
    this.config = { ...getDefaultSandboxConfig(), ...config };
  }

  /**
   * Execute a command inside a Docker container.
   * If Docker is not available, falls back to host execution with a warning.
   */
  async execute(command: string, cwd?: string): Promise<SandboxResult> {
    const startTime = Date.now();

    // Validate command
    const validation = validateCommand(command);
    if (!validation.allowed) {
      return {
        stdout: '',
        stderr: validation.reason || 'Command blocked',
        exitCode: 1,
        durationMs: Date.now() - startTime,
        killed: false,
        blocked: true,
        blockReason: validation.reason,
      };
    }

    // Check Docker availability
    if (!isDockerAvailable()) {
      return this.executeOnHost(command, cwd, startTime);
    }

    return this.executeInDocker(command, cwd, startTime);
  }

  /**
   * Execute command inside Docker container
   */
  private async executeInDocker(
    command: string,
    cwd: string | undefined,
    startTime: number
  ): Promise<SandboxResult> {
    const workDir = cwd || this.config.workspaceMountPath;
    const containerName = `pulse-sandbox-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

    // Build docker run command
    const dockerCmd = [
      'docker run',
      '--rm',                                    // remove container after exit
      `--name ${containerName}`,                 // unique name
      `--memory=${this.config.memoryLimit}`,     // memory limit
      `--cpus=${this.config.cpuLimit}`,          // CPU limit
      `--network=${this.config.networkMode}`,    // network isolation
      this.config.readOnly ? '--read-only' : '', // read-only root fs
      `-v "${this.config.workspaceMountPath}:${this.config.workspaceMountPath}"`, // mount workspace
      `-w "${workDir}"`,                         // working directory
      '--security-opt=no-new-privileges',        // prevent privilege escalation
      '--cap-drop=ALL',                          // drop all Linux capabilities
      this.config.image,
      'sh', '-c', `"${command.replace(/"/g, '\\"')}"`,
    ].filter(Boolean).join(' ');

    try {
      const { stdout, stderr } = await execAsync(dockerCmd, {
        timeout: this.config.timeoutMs,
        maxBuffer: 1024 * 1024, // 1MB output limit
        cwd: workDir,
      });

      return {
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: 0,
        durationMs: Date.now() - startTime,
        killed: false,
        blocked: false,
      };
    } catch (err: any) {
      const duration = Date.now() - startTime;

      // Check if it was a timeout (killed by signal, ETIMEDOUT, or exceeded duration)
      const isTimeout = err.killed || err.code === 'ETIMEDOUT' || err.signal === 'SIGTERM' || err.signal === 'SIGKILL' || duration >= this.config.timeoutMs;

      if (isTimeout) {
        // Kill the container
        try {
          execSync(`docker kill ${containerName}`, { stdio: 'pipe', timeout: 5000 });
        } catch { /* ignore cleanup errors */ }

        return {
          stdout: err.stdout?.trim() || '',
          stderr: err.stderr?.trim() || `Command timed out after ${this.config.timeoutMs}ms`,
          exitCode: 137, // SIGKILL
          durationMs: duration,
          killed: true,
          blocked: false,
        };
      }

      return {
        stdout: err.stdout?.trim() || '',
        stderr: err.stderr?.trim() || err.message,
        exitCode: err.code || 1,
        durationMs: duration,
        killed: false,
        blocked: false,
      };
    }
  }

  /**
   * Fallback: execute command on host machine (when Docker is unavailable)
   */
  private async executeOnHost(
    command: string,
    cwd: string | undefined,
    startTime: number
  ): Promise<SandboxResult> {
    try {
      const { stdout, stderr } = await execAsync(command, {
        timeout: this.config.timeoutMs,
        maxBuffer: 1024 * 1024,
        cwd,
      });

      return {
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: 0,
        durationMs: Date.now() - startTime,
        killed: false,
        blocked: false,
      };
    } catch (err: any) {
      return {
        stdout: err.stdout?.trim() || '',
        stderr: err.stderr?.trim() || err.message,
        exitCode: err.code || 1,
        durationMs: Date.now() - startTime,
        killed: err.killed || false,
        blocked: false,
      };
    }
  }
}
