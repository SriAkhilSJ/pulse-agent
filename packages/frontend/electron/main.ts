// packages/frontend/electron/main.ts
// Electron main process — starts backend + window

import { app, BrowserWindow, Menu } from 'electron';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { registerIpcHandlers } from './ipc-handlers.js';

let mainWindow: BrowserWindow | null = null;
let backendProcess: ChildProcess | null = null;

function startBackend() {
  const backendPath = path.join(__dirname, '../backend/dist/server.js');
  console.log('[Electron] Starting backend:', backendPath);

  backendProcess = spawn('node', [backendPath], {
    cwd: path.join(__dirname, '../backend'),
    stdio: 'inherit',
    env: { ...process.env },
  });

  backendProcess.on('error', (err) => {
    console.error('[Electron] Backend error:', err);
  });

  backendProcess.on('exit', (code) => {
    console.log('[Electron] Backend exited with code:', code);
  });
}

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

  const indexPath = path.join(__dirname, '../dist/index.html');
  console.log('[Electron] Loading:', indexPath);
  mainWindow.loadFile(indexPath);

  mainWindow.webContents.openDevTools();

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.error('[Electron] Load failed:', errorCode, errorDescription);
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  createApplicationMenu();
}

function createApplicationMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        { label: 'Open Folder...', accelerator: 'CmdOrCtrl+O', click: () => mainWindow?.webContents.send('menu-open-folder') },
        { type: 'separator' },
        { label: 'New File', accelerator: 'CmdOrCtrl+N', click: () => mainWindow?.webContents.send('menu-new-file') },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => mainWindow?.webContents.send('menu-save-file') },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { type: 'separator' }, { role: 'selectAll' }] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    {
      label: 'Agent',
      submenu: [
        { label: 'New Chat', accelerator: 'CmdOrCtrl+T', click: () => mainWindow?.webContents.send('menu-new-chat') },
        { label: 'Stop Agent', accelerator: 'CmdOrCtrl+.', click: () => mainWindow?.webContents.send('menu-stop-agent') },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  registerIpcHandlers();
  startBackend();

  // Wait for backend to be ready before creating window
  setTimeout(() => {
    createWindow();
  }, 2000);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (backendProcess) backendProcess.kill();
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('before-quit', () => {
  if (backendProcess) backendProcess.kill();
});
