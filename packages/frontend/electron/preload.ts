// packages/frontend/electron/preload.ts
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  chat: (message: string, sessionId: string) => ipcRenderer.invoke('backend:chat', message, sessionId),
});
