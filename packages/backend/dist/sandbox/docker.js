"use strict";
// packages/backend/src/sandbox/docker.ts
// Docker sandbox for safe command execution (optional, placeholder)
Object.defineProperty(exports, "__esModule", { value: true });
exports.runInDocker = runInDocker;
exports.isDockerAvailable = isDockerAvailable;
const child_process_1 = require("child_process");
const DEFAULT_SANDBOX = {
    image: 'node:18-alpine',
    memoryLimit: '512m',
    cpuLimit: '1.0',
    network: 'none',
    timeoutMs: 60000,
};
function runInDocker(command, config) {
    const cfg = { ...DEFAULT_SANDBOX, ...config };
    return new Promise((resolve, reject) => {
        const dockerCmd = `docker run --rm --memory="${cfg.memoryLimit}" --cpus="${cfg.cpuLimit}" --network="${cfg.network}" ${cfg.image} sh -c "${command.replace(/"/g, '\\"')}"`;
        (0, child_process_1.exec)(dockerCmd, { timeout: cfg.timeoutMs, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
            if (err)
                reject(new Error(stderr || err.message));
            else
                resolve(stdout);
        });
    });
}
function isDockerAvailable() {
    try {
        (0, child_process_1.execSync)('docker info', { timeout: 5000, stdio: 'pipe' });
        return true;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=docker.js.map