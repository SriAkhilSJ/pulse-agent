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
exports.clearReadCache = exports.searchCodeTool = exports.editFileTool = exports.listFilesTool = exports.writeFileTool = exports.readFileTool = void 0;
// packages/backend/src/tools/file/file-tools.ts
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const tool_registry_js_1 = require("../../tool-registry.js");
const fileCache = new Map();
exports.readFileTool = (0, tool_registry_js_1.defineTool)('read_file', 'Read a file from disk', {
    type: 'object',
    properties: { path: { type: 'string', description: 'File path to read' } },
    required: ['path'],
}, async (args) => {
    const filePath = String(args.path);
    const cached = fileCache.get(filePath);
    if (cached && Date.now() - cached.timestamp < 30000)
        return cached.content;
    const content = fs.readFileSync(filePath, 'utf-8');
    fileCache.set(filePath, { content, timestamp: Date.now() });
    return content;
});
exports.writeFileTool = (0, tool_registry_js_1.defineTool)('write_file', 'Write content to a file', {
    type: 'object',
    properties: {
        path: { type: 'string', description: 'File path to write' },
        content: { type: 'string', description: 'Content to write' },
    },
    required: ['path', 'content'],
}, async (args) => {
    const filePath = String(args.path);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir))
        fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, String(args.content), 'utf-8');
    fileCache.set(filePath, { content: String(args.content), timestamp: Date.now() });
    return `Written ${filePath}`;
});
exports.listFilesTool = (0, tool_registry_js_1.defineTool)('list_files', 'List files in a directory', {
    type: 'object',
    properties: { path: { type: 'string', description: 'Directory path' } },
    required: ['path'],
}, async (args) => {
    const dir = String(args.path);
    if (!fs.existsSync(dir))
        return `Directory not found: ${dir}`;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    return entries.map(e => (e.isDirectory() ? '[DIR] ' : '[FILE] ') + e.name).join('\n');
});
exports.editFileTool = (0, tool_registry_js_1.defineTool)('edit_file', 'Edit a file by replacing text', {
    type: 'object',
    properties: {
        path: { type: 'string', description: 'File path' },
        old_text: { type: 'string', description: 'Text to find' },
        new_text: { type: 'string', description: 'Replacement text' },
    },
    required: ['path', 'old_text', 'new_text'],
}, async (args) => {
    const filePath = String(args.path);
    const content = fs.readFileSync(filePath, 'utf-8');
    const oldText = String(args.old_text);
    if (!content.includes(oldText))
        return `Text not found in ${filePath}`;
    fs.writeFileSync(filePath, content.replace(oldText, String(args.new_text)), 'utf-8');
    return `Edited ${filePath}`;
});
exports.searchCodeTool = (0, tool_registry_js_1.defineTool)('search_code', 'Search for text in files', {
    type: 'object',
    properties: {
        query: { type: 'string', description: 'Search query' },
        path: { type: 'string', description: 'Directory to search in' },
    },
    required: ['query'],
}, async (args) => {
    const query = String(args.query).toLowerCase();
    const searchDir = args.path ? String(args.path) : process.cwd();
    const results = [];
    const walk = (dir) => {
        if (results.length >= 20)
            return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (results.length >= 20)
                return;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (!['node_modules', '.git', 'dist', 'out'].includes(entry.name))
                    walk(full);
            }
            else if (entry.name.match(/\.(ts|tsx|js|jsx|py|java|c|cpp|go|rs|rb|php|md|json|yaml|yml|html|css)$/)) {
                try {
                    const content = fs.readFileSync(full, 'utf-8');
                    const lines = content.split('\n');
                    for (let i = 0; i < lines.length; i++) {
                        if (lines[i].toLowerCase().includes(query)) {
                            results.push(`${full}:${i + 1}: ${lines[i].trim()}`);
                            break;
                        }
                    }
                }
                catch { /* skip */ }
            }
        }
    };
    walk(searchDir);
    return results.join('\n') || 'No matches found';
});
exports.clearReadCache = (0, tool_registry_js_1.defineTool)('clear_read_cache', 'Clear the file read cache', {
    type: 'object', properties: {}, required: [],
}, async () => {
    fileCache.clear();
    return 'Cache cleared';
});
//# sourceMappingURL=file-tools.js.map