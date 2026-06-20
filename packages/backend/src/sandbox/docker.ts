// packages/backend/src/sandbox/docker.ts
// Docker sandbox for safe command execution (optional, placeholder)

import { execSync, exec } from 'child_process';

export interface SandboxConfig {
  image: string;
  memoryLimit: string;
  cpuLimit: string;
  network: 'none' | 'bridge' | 'host';
  timeoutMs: number;
}

const DEFAULT_SANDBOX: SandboxConfig = {
  image: 'node:18-alpine',
  memoryLimit: '512m',
  cpuLimit: '1.0',
  network: 'none',
  timeoutMs: 60000,
};

export function runInDocker(command: string, config?: Partial<SandboxConfig>): Promise<string> {
  const cfg = { ...DEFAULT_SANDBOX, ...config };
  return new Promise((resolve, reject) => {
    const dockerCmd = `docker run --rm --memory="${cfg.memoryLimit}" --cpus="${cfg.cpuLimit}" --network="${cfg.network}" ${cfg.image} sh -c "${command.replace(/"/g, '\\"')}"`;
    exec(dockerCmd, { timeout: cfg.timeoutMs, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout);
    });
  });
}

export function isDockerAvailable(): boolean {
  try {
    execSync('docker info', { timeout: 5000, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}
