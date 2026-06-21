// packages/frontend/electron/preload.ts
// Preload script — exposes secure API to renderer via contextBridge

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // File system operations
  openFolder: () => ipcRenderer.invoke('open-folder'),
  readDirectory: (path: string, depth?: number) => ipcRenderer.invoke('read-directory', path, depth ?? 0),
  readFile: (path: string) => ipcRenderer.invoke('read-file', path),
  writeFile: (path: string, content: string) => ipcRenderer.invoke('write-file', path, content),
  deleteFile: (path: string) => ipcRenderer.invoke('delete-file', path),
  createFile: (path: string) => ipcRenderer.invoke('create-file', path),
  createFolder: (path: string) => ipcRenderer.invoke('create-folder', path),
  rename: (oldPath: string, newPath: string) => ipcRenderer.invoke('rename', oldPath, newPath),
  exists: (path: string) => ipcRenderer.invoke('exists', path),
  getStats: (path: string) => ipcRenderer.invoke('get-stats', path),

  // Backend communication
  chat: (message: string, sessionId: string) => ipcRenderer.invoke('backend:chat', message, sessionId),

  // App info
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getPlatform: () => process.platform,

  // Events
  onFileChanged: (callback: (path: string) => void) => {
    ipcRenderer.on('file-changed', (_event, path) => callback(path));
    return () => ipcRenderer.removeAllListeners('file-changed');
  },
});
