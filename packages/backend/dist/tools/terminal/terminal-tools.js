"use strict";
// packages/backend/src/tools/terminal/terminal-tools.ts
// Terminal tools — now with Docker sandbox integration
Object.defineProperty(exports, "__esModule", { value: true });
exports.getShellInfo = exports.detectTerminalProfile = exports.runTerminalTool = void 0;
const child_process_1 = require("child_process");
const tool_registry_js_1 = require("../../tool-registry.js");
const config_js_1 = require("../../config.js");
const docker_sandbox_js_1 = require("../../sandbox/docker-sandbox.js");
const shared_1 = require("@pulse-ide/shared");
// Singleton sandbox instance
let sandbox = null;
function getSandbox() {
    if (!sandbox) {
        sandbox = new docker_sandbox_js_1.DockerSandbox((0, shared_1.getDefaultSandboxConfig)());
    }
    return sandbox;
}
exports.runTerminalTool = (0, tool_registry_js_1.defineTool)('run_terminal', 'Run a shell command (sandboxed)', {
    type: 'object',
    properties: {
        command: { type: 'string', description: 'Shell command to execute' },
        cwd: { type: 'string', description: 'Working directory (optional)' },
        timeout_ms: { type: 'number', description: 'Timeout in ms (optional)' },
        use_sandbox: { type: 'boolean', description: 'Run in Docker sandbox (default: true)' },
    },
    required: ['command'],
}, async (args) => {
    const cmd = String(args.command);
    const cwd = args.cwd ? String(args.cwd) : process.cwd();
    const timeout = args.timeout_ms ? Number(args.timeout_ms) : config_js_1.config.terminalTimeoutMs;
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
        const output = (0, child_process_1.execSync)(cmd, { cwd, timeout, encoding: 'utf-8', maxBuffer: 1024 * 1024 });
        return output;
    }
    catch (err) {
        if (err.stdout)
            return err.stdout + '\n[ERROR]\n' + (err.stderr || '');
        throw new Error(`Command failed: ${err.message}`);
    }
});
exports.detectTerminalProfile = (0, tool_registry_js_1.defineTool)('detect_terminal_profile', 'Detect the current shell', {
    type: 'object', properties: {}, required: [],
}, async () => {
    const shell = process.env.SHELL || process.env.ComSpec || 'unknown';
    return `Shell: ${shell}`;
});
exports.getShellInfo = (0, tool_registry_js_1.defineTool)('get_shell_info', 'Get shell information', {
    type: 'object', properties: {}, required: [],
}, async () => {
    return JSON.stringify({
        shell: process.env.SHELL || process.env.ComSpec || 'unknown',
        platform: process.platform,
        cwd: process.cwd(),
    });
});
//# sourceMappingURL=terminal-tools.js.map