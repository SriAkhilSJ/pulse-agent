// packages/shared/types/sandbox.types.ts
// Docker Sandbox types — secure terminal execution

export interface SandboxConfig {
  cpuLimit: number;        // default 0.5 cores
  memoryLimit: string;     // default "512m"
  timeoutMs: number;       // default 30000
  workspaceMountPath: string;
  image: string;           // e.g., "node:20-alpine"
  networkMode: string;     // default "none" (no network)
  readOnly: boolean;       // default true (read-only root fs)
}

export interface SandboxResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  killed: boolean;
  blocked: boolean;
  blockReason?: string;
}

export function getDefaultSandboxConfig(workspacePath?: string): SandboxConfig {
  return {
    cpuLimit: 0.5,
    memoryLimit: '512m',
    timeoutMs: 30000,
    workspaceMountPath: workspacePath || process.env['WORKSPACE_PATH'] || '/workspace',
    image: process.env['SANDBOX_IMAGE'] || 'node:20-alpine',
    networkMode: 'none',
    readOnly: true,
  };
}

// Allowed command prefixes
export const ALLOWED_COMMANDS = [
  'npm', 'node', 'npx',
  'python', 'python3', 'pip', 'pip3',
  'ls', 'cat', 'grep', 'find', 'echo',
  'mkdir', 'touch', 'cp', 'mv',
  'head', 'tail', 'wc', 'sort', 'uniq',
  'git', 'tsc', 'eslint', 'prettier',
  'jest', 'pytest', 'go', 'cargo', 'rustc',
  'javac', 'java',
];

// Blocked patterns (regex)
export const BLOCKED_PATTERNS: RegExp[] = [
  /rm\s+-rf/,
  /rm\s+.*\s+\//,
  /sudo/,
  /chmod\s+777/,
  /chmod\s+-R/,
  /curl\s+.*\s+\|/,
  /wget/,
  /shutdown/,
  /reboot/,
  /dd\s+/,
  /mkfs/,
  /fdisk/,
  /mount/,
  /umount/,
  /kill\s+-9/,
  /pkill/,
  /killall/,
  /iptables/,
  /firewall/,
  /systemctl/,
  /service\s+.*\s+stop/,
  /service\s+.*\s+restart/,
  /docker\s+/,
  /docker-compose/,
  /nc\s+/,
  /netcat/,
  /bash\s+-c\s+.*rm/,
  /sh\s+-c\s+.*rm/,
  /eval\s+/,
  /exec\s+.*rm/,
  /dev\/null/,
  /proc\//,
  /sys\//,
];
