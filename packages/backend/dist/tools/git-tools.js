"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.gitStashTool = exports.gitCommitTool = exports.gitBranchTool = exports.gitLogTool = exports.gitDiffTool = exports.gitStatusTool = void 0;
// packages/backend/src/tools/git-tools.ts
const child_process_1 = require("child_process");
const tool_registry_js_1 = require("../tool-registry.js");
function gitCmd(args, subcmd) {
    const cwd = args.cwd ? String(args.cwd) : process.cwd();
    try {
        return (0, child_process_1.execSync)(`git ${subcmd}`, { cwd, encoding: 'utf-8', timeout: 10000 });
    }
    catch (err) {
        return err.stderr || err.message;
    }
}
exports.gitStatusTool = (0, tool_registry_js_1.defineTool)('git_status', 'Git status', {
    type: 'object', properties: { cwd: { type: 'string' } }, required: [],
}, (args) => Promise.resolve(gitCmd(args, 'status')));
exports.gitDiffTool = (0, tool_registry_js_1.defineTool)('git_diff', 'Git diff', {
    type: 'object', properties: { cwd: { type: 'string' } }, required: [],
}, (args) => Promise.resolve(gitCmd(args, 'diff')));
exports.gitLogTool = (0, tool_registry_js_1.defineTool)('git_log', 'Git log (last 10 commits)', {
    type: 'object', properties: { cwd: { type: 'string' } }, required: [],
}, (args) => Promise.resolve(gitCmd(args, 'log --oneline -10')));
exports.gitBranchTool = (0, tool_registry_js_1.defineTool)('git_branch', 'Git branch list', {
    type: 'object', properties: { cwd: { type: 'string' } }, required: [],
}, (args) => Promise.resolve(gitCmd(args, 'branch -a')));
exports.gitCommitTool = (0, tool_registry_js_1.defineTool)('git_commit', 'Git commit', {
    type: 'object', properties: { message: { type: 'string' }, cwd: { type: 'string' } },
    required: ['message'],
}, (args) => Promise.resolve(gitCmd(args, `commit -m "${String(args.message).replace(/"/g, '\\"')}"`)));
exports.gitStashTool = (0, tool_registry_js_1.defineTool)('git_stash', 'Git stash', {
    type: 'object', properties: { cwd: { type: 'string' } }, required: [],
}, (args) => Promise.resolve(gitCmd(args, 'stash')));
//# sourceMappingURL=git-tools.js.map