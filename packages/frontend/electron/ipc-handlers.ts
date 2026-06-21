// packages/frontend/electron/ipc-handlers.ts
// IPC handlers — file system operations for the renderer process

import { ipcMain, dialog } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'folder';
  children?: FileNode[];
  size?: number;
  modified?: number;
  depth: number;
}

const MAX_DEPTH = 5;
const SKIP_DIRS = new Set(['node_modules', '.git', '.svn', '.hg', 'dist', 'build', '.next', '.nuxt', 'coverage', '.cache', '.vscode', '.idea']);
const SKIP_FILES = new Set(['.DS_Store', 'Thumbs.db', '.env', '.env.local']);

async function readGitignore(dirPath: string): Promise<string[]> {
  try {
    const content = await fs.readFile(path.join(dirPath, '.gitignore'), 'utf-8');
    return content.split('\n').filter(line => line.trim() && !line.startsWith('#'));
  } catch {
    return [];
  }
}

async function shouldIgnore(name: string, dirPath: string, gitignorePatterns: string[]): Promise<boolean> {
  if (SKIP_DIRS.has(name) || SKIP_FILES.has(name)) return true;
  if (name.startsWith('.')) return true;

  // Check gitignore patterns (simplified)
  for (const pattern of gitignorePatterns) {
    if (pattern.startsWith('*')) {
      const ext = pattern.slice(1);
      if (name.endsWith(ext)) return true;
    } else if (name === pattern || name.startsWith(pattern)) {
      return true;
    }
  }
  return false;
}

async function readDirectoryRecursive(dirPath: string, depth: number, gitignorePatterns: string[]): Promise<FileNode[]> {
  if (depth > MAX_DEPTH) return [];

  let entries;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const children: FileNode[] = [];

  for (const entry of entries) {
    if (await shouldIgnore(entry.name, dirPath, gitignorePatterns)) continue;

    const fullPath = path.join(dirPath, entry.name);
    const node: FileNode = {
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
      } catch { /* ignore */ }
    }

    if (entry.isDirectory()) {
      node.children = await readDirectoryRecursive(fullPath, depth + 1, gitignorePatterns);
    }

    children.push(node);
  }

  // Sort: folders first, then files, alphabetically
  children.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return children;
}

export function registerIpcHandlers() {

  // Open folder dialog
  ipcMain.handle('open-folder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Open Project Folder',
    });
    if (!result.canceled && result.filePaths.length > 0) {
      return result.filePaths[0];
    }
    return null;
  });

  // Read directory (lazy load with depth)
  ipcMain.handle('read-directory', async (_, dirPath: string, depth: number = 0) => {
    try {
      const gitignorePatterns = await readGitignore(dirPath);
      const children = await readDirectoryRecursive(dirPath, depth, gitignorePatterns);
      return children;
    } catch (err) {
      console.error('read-directory error:', err);
      return [];
    }
  });

  // Read file content
  ipcMain.handle('read-file', async (_, filePath: string) => {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return content;
    } catch (err) {
      return `Error reading file: ${(err as Error).message}`;
    }
  });

  // Write file content
  ipcMain.handle('write-file', async (_, filePath: string, content: string) => {
    try {
      await fs.writeFile(filePath, content, 'utf-8');
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // Delete file
  ipcMain.handle('delete-file', async (_, filePath: string) => {
    try {
      await fs.unlink(filePath);
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // Create file
  ipcMain.handle('create-file', async (_, filePath: string) => {
    try {
      await fs.writeFile(filePath, '', 'utf-8');
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // Create folder
  ipcMain.handle('create-folder', async (_, folderPath: string) => {
    try {
      await fs.mkdir(folderPath, { recursive: true });
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // Rename/move
  ipcMain.handle('rename', async (_, oldPath: string, newPath: string) => {
    try {
      await fs.rename(oldPath, newPath);
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  });

  // Check if path exists
  ipcMain.handle('exists', async (_, filePath: string) => {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  });

  // Get file stats
  ipcMain.handle('get-stats', async (_, filePath: string) => {
    try {
      const stats = await fs.stat(filePath);
      return {
        size: stats.size,
        modified: stats.mtimeMs,
        created: stats.birthtimeMs,
        isDirectory: stats.isDirectory(),
        isFile: stats.isFile(),
      };
    } catch {
      return null;
    }
  });

  // App version
  ipcMain.handle('get-app-version', () => {
    return '0.1.0';
  });
}
