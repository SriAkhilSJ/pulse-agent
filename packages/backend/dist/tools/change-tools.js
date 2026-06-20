"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.clearChangeLog = exports.revertChangesTool = exports.getChangeLogTool = exports.logChangeTool = void 0;
// packages/backend/src/tools/change-tools.ts
const fs = __importStar(require("fs"));
const tool_registry_js_1 = require("../tool-registry.js");
const changeLog = [];
exports.logChangeTool = (0, tool_registry_js_1.defineTool)('log_change', 'Log a file change for potential revert', {
    type: 'object',
    properties: { path: { type: 'string' }, original: { type: 'string' }, new_content: { type: 'string' } },
    required: ['path', 'original', 'new_content'],
}, async (args) => {
    changeLog.push({ filePath: String(args.path), originalContent: String(args.original), newContent: String(args.new_content), timestamp: Date.now() });
    return `Logged change: ${args.path}`;
});
exports.getChangeLogTool = (0, tool_registry_js_1.defineTool)('get_change_log', 'Get the change log', {
    type: 'object', properties: {}, required: [],
}, async () => {
    return changeLog.map(c => `${c.filePath} @ ${new Date(c.timestamp).toISOString()}`).join('\n') || 'No changes logged';
});
exports.revertChangesTool = (0, tool_registry_js_1.defineTool)('revert_changes', 'Revert a file to its original content', {
    type: 'object', properties: { path: { type: 'string' } }, required: ['path'],
}, async (args) => {
    const filePath = String(args.path);
    const entry = [...changeLog].reverse().find(c => c.filePath === filePath);
    if (!entry)
        return `No change log entry for ${filePath}`;
    fs.writeFileSync(filePath, entry.originalContent, 'utf-8');
    return `Reverted ${filePath}`;
});
exports.clearChangeLog = (0, tool_registry_js_1.defineTool)('clear_change_log', 'Clear the change log', {
    type: 'object', properties: {}, required: [],
}, async () => { changeLog.length = 0; return 'Change log cleared'; });
//# sourceMappingURL=change-tools.js.map