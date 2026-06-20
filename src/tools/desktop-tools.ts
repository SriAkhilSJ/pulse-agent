// src/tools/desktop-tools.ts
// Desktop automation using @nut-tree-fork/nut-js.

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { defineTool } from '../tool-registry';

let nutLoaded = false;
let nut: any = null;

async function getNut(): Promise<any> {
  if (nut) return nut;
  try { nut = await import('@nut-tree-fork/nut-js'); nutLoaded = true; return nut; } catch {
    throw new Error('Desktop automation not available.\nInstall: npm install @nut-tree-fork/nut-js\nThen restart VS Code.');
  }
}

function getScreenshotDir(): string {
  const wf = vscode.workspace.workspaceFolders;
  const base = wf ? wf[0].uri.fsPath : process.cwd();
  const dir = path.join(base, '.pulse', 'screenshots');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const dt = (name: string, desc: string, params: any, handler: (args: Record<string, unknown>) => Promise<string>) => defineTool(name, desc, params, handler);

export const desktopMoveMouse = dt('desktop_move_mouse', 'Move mouse to coordinates',
  { type: 'object', properties: { x: { type: 'number', description: 'X coordinate' }, y: { type: 'number', description: 'Y coordinate' } }, required: ['x', 'y'] },
  async (args) => { const x = args.x as number; const y = args.y as number; if (x === undefined || y === undefined) throw new Error('desktop_move_mouse requires "x" + "y"'); const n = await getNut(); await n.mouse.setPosition({ x, y }); return 'Mouse moved to (' + x + ', ' + y + ')'; }
);

export const desktopClick = dt('desktop_click', 'Click the mouse',
  { type: 'object', properties: { button: { type: 'string', description: 'Button: left, right, middle (default: left)' } }, required: [] },
  async (args) => { const button = (args.button as string) || 'left'; const n = await getNut(); const btn = button === 'right' ? n.Button.RIGHT : button === 'middle' ? n.Button.MIDDLE : n.Button.LEFT; await n.mouse.click(btn); return button + ' click'; }
);

export const desktopDoubleClick = dt('desktop_double_click', 'Double-click the mouse',
  { type: 'object', properties: { button: { type: 'string', description: 'Button: left, right (default: left)' } }, required: [] },
  async (args) => { const button = (args.button as string) || 'left'; const n = await getNut(); const btn = button === 'right' ? n.Button.RIGHT : n.Button.LEFT; await n.mouse.doubleClick(btn); return 'Double ' + button + ' click'; }
);

export const desktopType = dt('desktop_type', 'Type text using the keyboard',
  { type: 'object', properties: { text: { type: 'string', description: 'Text to type' } }, required: ['text'] },
  async (args) => { const text = args.text as string; if (!text) throw new Error('desktop_type requires "text"'); const n = await getNut(); await n.keyboard.type(text); return 'Typed: ' + text.substring(0, 60) + (text.length > 60 ? '...' : ''); }
);

export const desktopTypeSlow = dt('desktop_type_slow', 'Type text slowly (character by character)',
  { type: 'object', properties: { text: { type: 'string', description: 'Text to type' }, delay: { type: 'number', description: 'Delay between chars in ms (default: 50)' } }, required: ['text'] },
  async (args) => { const text = args.text as string; const delay = (args.delay as number) || 50; if (!text) throw new Error('desktop_type_slow requires "text"'); const n = await getNut(); for (const char of text) { await n.keyboard.type(char); await new Promise(r => setTimeout(r, delay)); } return 'Typed slowly: ' + text.substring(0, 60); }
);

export const desktopPressKey = dt('desktop_press_key', 'Press a key or key combination',
  { type: 'object', properties: { key: { type: 'string', description: 'Key name (e.g., Enter, Tab, Ctrl+C)' } }, required: ['key'] },
  async (args) => { const key = args.key as string; if (!key) throw new Error('desktop_press_key requires "key"'); const n = await getNut(); if (key.includes('+')) { const parts = key.split('+').map(s => s.trim()); const modifiers = parts.slice(0, -1); const mainKey = parts[parts.length - 1]; for (const mod of modifiers) await n.keyboard.pressKey(mod as any); await n.keyboard.pressKey(mainKey as any); for (const mod of modifiers.reverse()) await n.keyboard.releaseKey(mod as any); } else { await n.keyboard.pressKey(key as any); await n.keyboard.releaseKey(key as any); } return 'Pressed: ' + key; }
);

export const desktopScroll = dt('desktop_scroll', 'Scroll the mouse wheel',
  { type: 'object', properties: { direction: { type: 'string', description: 'Direction: up, down (default: down)' }, amount: { type: 'number', description: 'Scroll amount (default: 3)' } }, required: ['direction'] },
  async (args) => { const amount = (args.amount as number) || 3; const direction = (args.direction as string) || 'down'; const n = await getNut(); const delta = direction === 'down' ? amount : direction === 'up' ? -amount : 0; await n.mouse.scrollDown(delta); return 'Scrolled ' + direction + ' by ' + amount; }
);

export const desktopScreenshot = dt('desktop_screenshot', 'Take a screenshot of the desktop',
  { type: 'object', properties: { name: { type: 'string', description: 'Screenshot name (optional)' } }, required: [] },
  async (args) => { const n = await getNut(); const dir = getScreenshotDir(); const name = (args.name as string) || 'desktop-' + Date.now(); const filePath = path.join(dir, name + '.png'); try { const img = await n.screen.capture(); if (typeof img.save === 'function') { await img.save(filePath); } else { if (process.platform === 'darwin') { execSync('screencapture -x "' + filePath + '"'); } else if (process.platform === 'linux') { execSync('import -window root "' + filePath + '"'); } else { const psCommand = ['Add-Type -AssemblyName System.Drawing', 'Add-Type -AssemblyName System.Windows.Forms', '$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds', '$bitmap = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)', '$graphics = [System.Drawing.Graphics]::FromImage($bitmap)', '$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)', `$bitmap.Save('${filePath.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png)`, '$graphics.Dispose()', '$bitmap.Dispose()'].join('; '); execSync('powershell -Command "' + psCommand.replace(/"/g, '\\"') + '"', { timeout: 10000 }); } } return 'Screenshot: ' + filePath; } catch (err) { return 'Screenshot failed: ' + (err as Error).message; } }
);

export const desktopGetScreenSize = dt('desktop_get_screen_size', 'Get the screen resolution',
  { type: 'object', properties: {}, required: [] },
  async () => { const n = await getNut(); const w = await n.screen.width(); const h = await n.screen.height(); return 'Screen size: ' + w + 'x' + h; }
);

export const desktopGetActiveWindow = dt('desktop_get_active_window', 'Get information about the active window',
  { type: 'object', properties: {}, required: [] },
  async () => { try { if (process.platform === 'win32') { const ps = 'Add-Type -AssemblyName System.Windows.Forms;[System.Windows.Forms.Screen]::PrimaryScreen.Bounds'; const bounds = execSync('powershell -Command "' + ps + '"', { encoding: 'utf-8' }).trim(); return JSON.stringify({ platform: 'win32', screenBounds: bounds }); } else if (process.platform === 'darwin') { const title = execSync('osascript -e "tell application \\"System Events\\" to get name of first application process whose frontmost is true"', { encoding: 'utf-8' }).trim(); return JSON.stringify({ platform: 'darwin', frontmostApp: title }); } else { const title = execSync('xdotool getactivewindow getwindowname 2>/dev/null || echo unknown', { encoding: 'utf-8' }).trim(); return JSON.stringify({ platform: 'linux', windowTitle: title }); } } catch { return 'Could not get active window'; } }
);

export const desktopFindImage = dt('desktop_find_image', 'Find an image on screen',
  { type: 'object', properties: { image: { type: 'string', description: 'Path to image template file' } }, required: ['image'] },
  async (args) => { const imagePath = args.image as string; if (!imagePath) throw new Error('desktop_find_image requires "image"'); const n = await getNut(); const fullPath = path.resolve((vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd()), imagePath); try { const result = await n.screen.find(fullPath); return JSON.stringify({ found: true, x: result.left + result.width / 2, y: result.top + result.height / 2, width: result.width, height: result.height, confidence: result.confidence }, null, 2); } catch { return JSON.stringify({ found: false, image: imagePath }); } }
);

export const desktopClickImage = dt('desktop_click_image', 'Find and click an image on screen',
  { type: 'object', properties: { image: { type: 'string', description: 'Path to image template file' } }, required: ['image'] },
  async (args) => { const imagePath = args.image as string; if (!imagePath) throw new Error('desktop_click_image requires "image"'); const n = await getNut(); const fullPath = path.resolve((vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd()), imagePath); try { const result = await n.screen.find(fullPath); const centerX = result.left + result.width / 2; const centerY = result.top + result.height / 2; await n.mouse.setPosition({ x: centerX, y: centerY }); await n.mouse.click(n.Button.LEFT); return 'Clicked image at (' + centerX + ', ' + centerY + ')'; } catch { throw new Error('Image not found on screen: ' + imagePath); } }
);
