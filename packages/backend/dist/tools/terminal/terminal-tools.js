"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getShellInfo = exports.detectTerminalProfile = exports.runTerminalTool = void 0;
// packages/backend/src/tools/terminal/terminal-tools.ts
const child_process_1 = require("child_process");
const tool_registry_js_1 = require("../../tool-registry.js");
const config_js_1 = require("../../config.js");
exports.runTerminalTool = (0, tool_registry_js_1.defineTool)('run_terminal', 'Run a shell command', {
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
    const timeout = args.timeout_ms ? Number(args.timeout_ms) : config_js_1.config.terminalTimeoutMs;
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