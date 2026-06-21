"use strict";
// packages/frontend/electron/preload.ts
// Preload script — exposes secure API to renderer via contextBridge
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('electronAPI', {
    // File system operations
    openFolder: () => electron_1.ipcRenderer.invoke('open-folder'),
    readDirectory: (path, depth) => electron_1.ipcRenderer.invoke('read-directory', path, depth ?? 0),
    readFile: (path) => electron_1.ipcRenderer.invoke('read-file', path),
    writeFile: (path, content) => electron_1.ipcRenderer.invoke('write-file', path, content),
    deleteFile: (path) => electron_1.ipcRenderer.invoke('delete-file', path),
    createFile: (path) => electron_1.ipcRenderer.invoke('create-file', path),
    createFolder: (path) => electron_1.ipcRenderer.invoke('create-folder', path),
    rename: (oldPath, newPath) => electron_1.ipcRenderer.invoke('rename', oldPath, newPath),
    exists: (path) => electron_1.ipcRenderer.invoke('exists', path),
    getStats: (path) => electron_1.ipcRenderer.invoke('get-stats', path),
    // Backend communication
    chat: (message, sessionId) => electron_1.ipcRenderer.invoke('backend:chat', message, sessionId),
    // App info
    getAppVersion: () => electron_1.ipcRenderer.invoke('get-app-version'),
    getPlatform: () => process.platform,
    // Events
    onFileChanged: (callback) => {
        electron_1.ipcRenderer.on('file-changed', (_event, path) => callback(path));
        return () => electron_1.ipcRenderer.removeAllListeners('file-changed');
    },
});
