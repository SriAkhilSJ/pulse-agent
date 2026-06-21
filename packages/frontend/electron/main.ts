// packages/frontend/electron/main.ts
// Electron main process — window management + IPC handlers

import { app, BrowserWindow, Menu, ipcMain } from 'electron';
import * as path from 'path';
import { registerIpcHandlers } from './ipc-handlers.js';

// __dirname is already available in CommonJS (Node.js)

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'PulseCode AI IDE',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
  });

  // Always load built files in production
  const indexPath = path.join(__dirname, '../dist/index.html');
  console.log('[Electron] Loading:', indexPath);
  mainWindow.loadFile(indexPath);
  
  // Open DevTools for debugging
  mainWindow.webContents.openDevTools();
  
  // Log any load errors
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.error('[Electron] Load failed:', errorCode, errorDescription);
  });
  
  // Log console errors from renderer
  mainWindow.webContents.on('console-message', (_event, level, message) => {
    if (level >= 2) console.error('[Renderer]', message);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Create application menu
  createApplicationMenu();
}

function createApplicationMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Folder...',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            if (mainWindow) {
              mainWindow.webContents.send('menu-open-folder');
            }
          },
        },
        { type: 'separator' },
        {
          label: 'New File',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('menu-new-file');
            }
          },
        },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('menu-save-file');
            }
          },
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { type: 'separator' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Agent',
      submenu: [
        {
          label: 'New Chat',
          accelerator: 'CmdOrCtrl+T',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('menu-new-chat');
            }
          },
        },
        {
          label: 'Stop Agent',
          accelerator: 'CmdOrCtrl+.',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('menu-stop-agent');
            }
          },
        },
        { type: 'separator' },
        {
          label: 'Clear History',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('menu-clear-history');
            }
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(() => {
  // Register all IPC handlers
  registerIpcHandlers();

  // Legacy chat handler (kept for backward compatibility)
  ipcMain.handle('backend:chat', async (_event, message: string, sessionId: string) => {
    try {
      const response = await fetch('http://127.0.0.1:3001/api/agent/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, sessionId }),
      });
      return response.json();
    } catch (err) {
      return { error: (err as Error).message };
    }
  });

  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
