"use strict";
// packages/frontend/electron/ipc-handlers.ts
// IPC handlers — file system operations for the renderer process
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
exports.registerIpcHandlers = registerIpcHandlers;
const electron_1 = require("electron");
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
const MAX_DEPTH = 5;
const SKIP_DIRS = new Set(['node_modules', '.git', '.svn', '.hg', 'dist', 'build', '.next', '.nuxt', 'coverage', '.cache', '.vscode', '.idea']);
const SKIP_FILES = new Set(['.DS_Store', 'Thumbs.db', '.env', '.env.local']);
async function readGitignore(dirPath) {
    try {
        const content = await fs.readFile(path.join(dirPath, '.gitignore'), 'utf-8');
        return content.split('\n').filter(line => line.trim() && !line.startsWith('#'));
    }
    catch {
        return [];
    }
}
async function shouldIgnore(name, dirPath, gitignorePatterns) {
    if (SKIP_DIRS.has(name) || SKIP_FILES.has(name))
        return true;
    if (name.startsWith('.'))
        return true;
    // Check gitignore patterns (simplified)
    for (const pattern of gitignorePatterns) {
        if (pattern.startsWith('*')) {
            const ext = pattern.slice(1);
            if (name.endsWith(ext))
                return true;
        }
        else if (name === pattern || name.startsWith(pattern)) {
            return true;
        }
    }
    return false;
}
async function readDirectoryRecursive(dirPath, depth, gitignorePatterns) {
    if (depth > MAX_DEPTH)
        return [];
    let entries;
    try {
        entries = await fs.readdir(dirPath, { withFileTypes: true });
    }
    catch {
        return [];
    }
    const children = [];
    for (const entry of entries) {
        if (await shouldIgnore(entry.name, dirPath, gitignorePatterns))
            continue;
        const fullPath = path.join(dirPath, entry.name);
        const node = {
            name: entry.name,
            path: fullPath,
            type: entry.isDirectory() ? 'folder' : 'file',
            depth,
        };
        if (entry.isFile()) {
            try {
                const stats = await fs.stat(fullPath);
                node.size = stats.size;
                node.modified = stats.mtimeMs;
            }
            catch { /* ignore */ }
        }
        if (entry.isDirectory()) {
            node.children = await readDirectoryRecursive(fullPath, depth + 1, gitignorePatterns);
        }
        children.push(node);
    }
    // Sort: folders first, then files, alphabetically
    children.sort((a, b) => {
        if (a.type !== b.type)
            return a.type === 'folder' ? -1 : 1;
        return a.name.localeCompare(b.name);
    });
    return children;
}
function registerIpcHandlers() {
    // Open folder dialog
    electron_1.ipcMain.handle('open-folder', async () => {
        const result = await electron_1.dialog.showOpenDialog({
            properties: ['openDirectory'],
            title: 'Open Project Folder',
        });
        if (!result.canceled && result.filePaths.length > 0) {
            return result.filePaths[0];
        }
        return null;
    });
    // Read directory (lazy load with depth)
    electron_1.ipcMain.handle('read-directory', async (_, dirPath, depth = 0) => {
        try {
            const gitignorePatterns = await readGitignore(dirPath);
            const children = await readDirectoryRecursive(dirPath, depth, gitignorePatterns);
            return children;
        }
        catch (err) {
            console.error('read-directory error:', err);
            return [];
        }
    });
    // Read file content
    electron_1.ipcMain.handle('read-file', async (_, filePath) => {
        try {
            const content = await fs.readFile(filePath, 'utf-8');
            return content;
        }
        catch (err) {
            return `Error reading file: ${err.message}`;
        }
    });
    // Write file content
    electron_1.ipcMain.handle('write-file', async (_, filePath, content) => {
        try {
            await fs.writeFile(filePath, content, 'utf-8');
            return { success: true };
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    // Delete file
    electron_1.ipcMain.handle('delete-file', async (_, filePath) => {
        try {
            await fs.unlink(filePath);
            return { success: true };
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    // Create file
    electron_1.ipcMain.handle('create-file', async (_, filePath) => {
        try {
            await fs.writeFile(filePath, '', 'utf-8');
            return { success: true };
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    // Create folder
    electron_1.ipcMain.handle('create-folder', async (_, folderPath) => {
        try {
            await fs.mkdir(folderPath, { recursive: true });
            return { success: true };
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    // Rename/move
    electron_1.ipcMain.handle('rename', async (_, oldPath, newPath) => {
        try {
            await fs.rename(oldPath, newPath);
            return { success: true };
        }
        catch (err) {
            return { success: false, error: err.message };
        }
    });
    // Check if path exists
    electron_1.ipcMain.handle('exists', async (_, filePath) => {
        try {
            await fs.access(filePath);
            return true;
        }
        catch {
            return false;
        }
    });
    // Get file stats
    electron_1.ipcMain.handle('get-stats', async (_, filePath) => {
        try {
            const stats = await fs.stat(filePath);
            return {
                size: stats.size,
                modified: stats.mtimeMs,
                created: stats.birthtimeMs,
                isDirectory: stats.isDirectory(),
                isFile: stats.isFile(),
            };
        }
        catch {
            return null;
        }
    });
    // App version
    electron_1.ipcMain.handle('get-app-version', () => {
        return '0.1.0';
    });
}
