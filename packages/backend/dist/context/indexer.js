"use strict";
// packages/backend/src/context/indexer.ts
// Context Engine — Codebase indexer with RAG-based search (standalone, no VS Code deps)
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
exports.ContextEngine = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const config_js_1 = require("../config.js");
class ContextEngine {
    index = new Map();
    workspaceRoot = '';
    maxIndexSize = config_js_1.config.contextMaxFiles;
    constructor(workspaceRoot) {
        this.workspaceRoot = workspaceRoot || process.cwd();
    }
    async initialize() {
        if (!this.workspaceRoot)
            return;
        console.log('[ContextEngine] Initializing...');
        await this.indexWorkspace();
        console.log('[ContextEngine] Indexed ' + this.index.size + ' files');
    }
    async indexWorkspace() {
        const files = this.findFiles();
        const maxFiles = Math.min(files.length, this.maxIndexSize);
        const BATCH_SIZE = config_js_1.config.contextBatchSize;
        for (let i = 0; i < maxFiles; i++) {
            const filePath = files[i];
            try {
                const content = fs.readFileSync(filePath, 'utf-8');
                const stat = fs.statSync(filePath);
                this.indexFile(filePath, content, stat.mtimeMs);
            }
            catch { /* skip */ }
            if (i > 0 && i % BATCH_SIZE === 0) {
                await new Promise(r => setTimeout(r, 0));
            }
        }
    }
    findFiles() {
        const results = [];
        const exts = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.c', '.cpp', '.cs', '.go', '.rb', '.php', '.rs', '.md', '.json', '.yaml', '.yml', '.xml', '.html', '.css', '.scss', '.sh', '.bash', '.zsh', '.ps1', '.sql']);
        const skipDirs = new Set(['node_modules', '.git', 'out', 'dist', 'build', '.vscode', '.pulse']);
        const walk = (dir) => {
            if (results.length >= this.maxIndexSize)
                return;
            let entries;
            try {
                entries = fs.readdirSync(dir, { withFileTypes: true });
            }
            catch {
                return;
            }
            for (const entry of entries) {
                if (results.length >= this.maxIndexSize)
                    return;
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (!skipDirs.has(entry.name))
                        walk(full);
                }
                else if (exts.has(path.extname(entry.name))) {
                    results.push(full);
                }
            }
        };
        walk(this.workspaceRoot);
        return results;
    }
    indexFile(filePath, content, lastModified) {
        const lines = content.split('\n');
        const symbols = this.extractSymbols(content);
        const relPath = this.workspaceRoot ? path.relative(this.workspaceRoot, filePath) : filePath;
        this.index.set(filePath, { filePath: relPath, content, lines, lastModified, symbols });
    }
    extractSymbols(content) {
        const symbols = [];
        const patterns = [
            /(?:export\s+)?(?:async\s+)?function\s+(\w+)/g,
            /(?:export\s+)?class\s+(\w+)/g,
            /(?:export\s+)?const\s+(\w+)\s*=/g,
            /(?:export\s+)?interface\s+(\w+)/g,
            /(?:export\s+)?type\s+(\w+)/g,
            /(?:export\s+)?enum\s+(\w+)/g,
            /def\s+(\w+)/g,
            /fn\s+(\w+)/g,
            /func\s+(\w+)/g,
        ];
        for (const pattern of patterns) {
            let match;
            while ((match = pattern.exec(content)) !== null) {
                symbols.push(match[1]);
            }
        }
        return [...new Set(symbols)];
    }
    search(query, maxResults = 10) {
        const queryLower = query.toLowerCase();
        const queryTerms = queryLower.split(/\s+/).filter(t => t.length > 2);
        const results = [];
        const seen = new Set();
        for (const [filePath, entry] of this.index) {
            for (const symbol of entry.symbols) {
                if (queryLower.includes(symbol.toLowerCase())) {
                    const key = filePath + ':symbol:' + symbol;
                    if (!seen.has(key)) {
                        seen.add(key);
                        results.push({ filePath: entry.filePath, lineStart: 1, lineEnd: 1, content: 'Symbol: ' + symbol, score: 10 });
                    }
                }
            }
            for (let i = 0; i < entry.lines.length; i++) {
                const lineLower = entry.lines[i].toLowerCase();
                let matched = false;
                for (const term of queryTerms) {
                    if (lineLower.includes(term)) {
                        matched = true;
                        break;
                    }
                }
                if (matched) {
                    const start = Math.max(0, i - 2);
                    const end = Math.min(entry.lines.length, i + 3);
                    const key = filePath + ':' + start;
                    if (!seen.has(key)) {
                        seen.add(key);
                        results.push({
                            filePath: entry.filePath,
                            lineStart: start + 1,
                            lineEnd: end,
                            content: entry.lines.slice(start, end).join('\n'),
                            score: queryTerms.filter(t => lineLower.includes(t)).length * 2
                        });
                    }
                }
            }
        }
        return results.sort((a, b) => b.score - a.score).slice(0, maxResults);
    }
    getCurrentContext() {
        const recentFiles = [...this.index.values()].sort((a, b) => b.lastModified - a.lastModified).slice(0, 5);
        if (recentFiles.length === 0)
            return '';
        let context = '## Workspace Context\n';
        context += '### Recently modified:\n';
        for (const f of recentFiles) {
            context += '- ' + f.filePath + ' (' + f.symbols.slice(0, 5).join(', ') + ')\n';
        }
        return context;
    }
    getIndexSize() { return this.index.size; }
}
exports.ContextEngine = ContextEngine;
//# sourceMappingURL=indexer.js.map