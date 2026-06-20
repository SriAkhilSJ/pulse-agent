// src/tools/android-tools.ts
// Android device control via ADB.

import { defineTool } from '../tool-registry';
import { runTerminalTool } from './terminal-tools';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

let adbAvailable: boolean | null = null;
let adbCheckTimestamp = 0;
const ADB_CACHE_TTL = 30_000;

async function checkAdbAvailable(): Promise<boolean> {
  const now = Date.now();
  if (adbAvailable !== null && now - adbCheckTimestamp < ADB_CACHE_TTL) return adbAvailable;
  try { const result = await runTerminalTool({ command: 'adb version' }); adbAvailable = result.includes('Android Debug Bridge') || result.includes('version'); } catch { adbAvailable = false; }
  adbCheckTimestamp = now;
  return adbAvailable;
}

async function ensureScreenshotsDir(): Promise<string> {
  const wf = vscode.workspace.workspaceFolders;
  const base = wf ? wf[0].uri.fsPath : process.cwd();
  const dir = path.join(base, '.pulse', 'screenshots');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const at = (name: string, desc: string, params: any, handler: (args: Record<string, unknown>) => Promise<string>) => defineTool(name, desc, params, handler);

export const androidDevices = at('android_devices', 'List connected Android devices via ADB',
  { type: 'object', properties: {}, required: [] },
  async () => { if (!await checkAdbAvailable()) return '❌ ADB not found. Install Android SDK Platform Tools.'; return runTerminalTool({ command: 'adb devices -l' }); }
);

export const androidGetInfo = at('android_get_info', 'Get Android device info (model, version, battery)',
  { type: 'object', properties: {}, required: [] },
  async () => {
    if (!await checkAdbAvailable()) return '❌ ADB not available.';
    const [model, androidVersion, sdk, battery] = await Promise.all([
      runTerminalTool({ command: 'adb shell getprop ro.product.model' }).catch(() => 'unknown'),
      runTerminalTool({ command: 'adb shell getprop ro.build.version.release' }).catch(() => 'unknown'),
      runTerminalTool({ command: 'adb shell getprop ro.build.version.sdk' }).catch(() => 'unknown'),
      runTerminalTool({ command: 'adb shell dumpsys battery | grep level' }).catch(() => 'unknown'),
    ]);
    return JSON.stringify({ model: model.trim(), androidVersion: androidVersion.trim(), sdk: sdk.trim(), battery: battery.trim() }, null, 2);
  }
);

export const androidLaunch = at('android_launch', 'Launch an Android app by package name',
  { type: 'object', properties: { package: { type: 'string', description: 'Package name (e.g., com.example.app)' } }, required: ['package'] },
  async (args) => {
    if (!await checkAdbAvailable()) return '❌ ADB not available.';
    const packageName = args.package as string;
    if (!packageName) throw new Error('android_launch requires "package"');
    const safePkg = packageName.replace(/[^a-zA-Z0-9._]/g, '');
    if (safePkg !== packageName) throw new Error('Invalid package name: ' + packageName);
    const result = await runTerminalTool({ command: `adb shell monkey -p ${safePkg} -c android.intent.category.LAUNCHER 1 2>&1 || adb shell am start -n ${safePkg}/.MainActivity 2>&1` });
    await new Promise(r => setTimeout(r, 3000));
    const dir = await ensureScreenshotsDir();
    const filePath = path.join(dir, 'android-launch-' + Date.now() + '.png');
    try { await runTerminalTool({ command: 'adb shell screencap -p /sdcard/screenshot.png' }); await runTerminalTool({ command: `adb pull /sdcard/screenshot.png "${filePath}"` }); return 'Launched: ' + packageName + '\nScreenshot: ' + filePath; } catch { return 'Launched: ' + packageName + ' (screenshot failed)'; }
  }
);

export const androidClick = at('android_click', 'Tap on an Android element by resource-id or coordinates',
  { type: 'object', properties: { resource_id: { type: 'string', description: 'Resource ID or "x,y" coordinates' } }, required: ['resource_id'] },
  async (args) => {
    if (!await checkAdbAvailable()) return '❌ ADB not available.';
    const resourceId = args.resource_id as string;
    if (!resourceId) throw new Error('android_click requires "resource_id"');
    if (resourceId.includes(',')) { const [x, y] = resourceId.split(',').map(s => s.trim()); await runTerminalTool({ command: `adb shell input tap ${x} ${y}` }); await new Promise(r => setTimeout(r, 500)); return 'Tapped at (' + x + ', ' + y + ')'; }
    const uiResult = await runTerminalTool({ command: `adb shell uiautomator dump /sdcard/window.xml 2>&1 && adb shell cat /sdcard/window.xml` });
    const boundsMatch = uiResult.match(new RegExp(`resource-id="${resourceId}"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`));
    if (boundsMatch) { const x1 = parseInt(boundsMatch[1]), y1 = parseInt(boundsMatch[2]); const x2 = parseInt(boundsMatch[3]), y2 = parseInt(boundsMatch[4]); const cx = Math.round((x1 + x2) / 2); const cy = Math.round((y1 + y2) / 2); await runTerminalTool({ command: `adb shell input tap ${cx} ${cy}` }); await new Promise(r => setTimeout(r, 500)); return 'Tapped: ' + resourceId + ' at (' + cx + ', ' + cy + ')'; }
    return androidClickText({ text: resourceId });
  }
);

export const androidClickText = at('android_click_text', 'Tap on an Android element by text',
  { type: 'object', properties: { text: { type: 'string', description: 'Text to find and tap' } }, required: ['text'] },
  async (args) => {
    if (!await checkAdbAvailable()) return '❌ ADB not available.';
    const text = args.text as string;
    if (!text) throw new Error('android_click_text requires "text"');
    const uiResult = await runTerminalTool({ command: `adb shell uiautomator dump /sdcard/window.xml 2>&1 && adb shell cat /sdcard/window.xml` });
    const boundsMatch = uiResult.match(new RegExp(`text="${text}"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`));
    if (boundsMatch) { const x1 = parseInt(boundsMatch[1]), y1 = parseInt(boundsMatch[2]); const x2 = parseInt(boundsMatch[3]), y2 = parseInt(boundsMatch[4]); const cx = Math.round((x1 + x2) / 2); const cy = Math.round((y1 + y2) / 2); await runTerminalTool({ command: `adb shell input tap ${cx} ${cy}` }); await new Promise(r => setTimeout(r, 500)); return 'Tapped text: "' + text + '" at (' + cx + ', ' + cy + ')'; }
    return 'Text not found: "' + text + '"';
  }
);

export const androidType = at('android_type', 'Type text on Android',
  { type: 'object', properties: { text: { type: 'string', description: 'Text to type' } }, required: ['text'] },
  async (args) => { if (!await checkAdbAvailable()) return '❌ ADB not available.'; const text = args.text as string; if (!text) throw new Error('android_type requires "text"'); const safeText = text.replace(/["$`\\]/g, ''); await runTerminalTool({ command: `adb shell input text "${safeText}"` }); return 'Typed: ' + text.substring(0, 60); }
);

export const androidSwipe = at('android_swipe', 'Swipe on Android screen',
  { type: 'object', properties: { x1: { type: 'number', description: 'Start X' }, y1: { type: 'number', description: 'Start Y' }, x2: { type: 'number', description: 'End X' }, y2: { type: 'number', description: 'End Y' }, duration: { type: 'number', description: 'Duration ms (default: 300)' } }, required: ['x1', 'y1', 'x2', 'y2'] },
  async (args) => { if (!await checkAdbAvailable()) return '❌ ADB not available.'; const x1 = args.x1 as number, y1 = args.y1 as number; const x2 = args.x2 as number, y2 = args.y2 as number; if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) throw new Error('android_swipe requires x1, y1, x2, y2'); const duration = (args.duration as number) || 300; await runTerminalTool({ command: `adb shell input swipe ${x1} ${y1} ${x2} ${y2} ${duration}` }); return 'Swiped from (' + x1 + ',' + y1 + ') to (' + x2 + ',' + y2 + ')'; }
);

export const androidScreenshot = at('android_screenshot', 'Take a screenshot of the Android device',
  { type: 'object', properties: { name: { type: 'string', description: 'Screenshot name (optional)' } }, required: [] },
  async (args) => {
    if (!await checkAdbAvailable()) return '❌ ADB not available.';
    const name = (args.name as string) || 'android-' + Date.now();
    const dir = await ensureScreenshotsDir();
    const filePath = path.join(dir, name + '.png');
    try { await runTerminalTool({ command: 'adb shell screencap -p /sdcard/screenshot.png' }); await runTerminalTool({ command: `adb pull /sdcard/screenshot.png "${filePath}"` }); await runTerminalTool({ command: 'adb shell rm /sdcard/screenshot.png' }); return 'Screenshot: ' + filePath; } catch (err) { return 'Screenshot failed: ' + (err as Error).message; }
  }
);

export const androidGetUI = at('android_get_ui', 'Get the Android UI hierarchy as JSON',
  { type: 'object', properties: {}, required: [] },
  async () => {
    if (!await checkAdbAvailable()) return '❌ ADB not available.';
    const uiXml = await runTerminalTool({ command: 'adb shell uiautomator dump /sdcard/window.xml 2>&1 && adb shell cat /sdcard/window.xml' });
    const elements: any[] = [];
    const nodeRegex = /<node[^>]*>/g;
    let match;
    while ((match = nodeRegex.exec(uiXml)) !== null) {
      const node = match[0];
      const attrs: any = {};
      const attrRegex = /(\w+)="([^"]*)"/g;
      let attrMatch;
      while ((attrMatch = attrRegex.exec(node)) !== null) attrs[attrMatch[1]] = attrMatch[2];
      if (attrs.text || attrs['resource-id']) elements.push({ text: attrs.text || '', resourceId: attrs['resource-id'] || '', className: attrs['class'] || '', bounds: attrs.bounds || '', clickable: attrs.clickable === 'true', enabled: attrs.enabled !== 'false' });
    }
    return JSON.stringify({ elements, count: elements.length }, null, 2);
  }
);

export const androidWait = at('android_wait', 'Wait for text to appear on Android screen',
  { type: 'object', properties: { text: { type: 'string', description: 'Text to wait for' }, timeout: { type: 'number', description: 'Timeout ms (default: 10000)' } }, required: ['text'] },
  async (args) => {
    if (!await checkAdbAvailable()) return '❌ ADB not available.';
    const text = args.text as string;
    const timeout = (args.timeout as number) || 10000;
    const start = Date.now();
    while (Date.now() - start < timeout) {
      try { const uiResult = await runTerminalTool({ command: 'adb shell uiautomator dump /sdcard/window.xml 2>&1 && adb shell cat /sdcard/window.xml' }); if (uiResult.includes(`text="${text}"`)) return 'Found text: "' + text + '" after ' + ((Date.now() - start) / 1000).toFixed(1) + 's'; } catch { /* keep trying */ }
      await new Promise(r => setTimeout(r, 1000));
    }
    return 'Timeout: Text "' + text + '" not found within ' + (timeout / 1000) + 's';
  }
);

export const androidBack = at('android_back', 'Press the Android back button',
  { type: 'object', properties: {}, required: [] },
  async () => { if (!await checkAdbAvailable()) return '❌ ADB not available.'; await runTerminalTool({ command: 'adb shell input keyevent KEYCODE_BACK' }); return 'Back pressed'; }
);

export const androidHome = at('android_home', 'Press the Android home button',
  { type: 'object', properties: {}, required: [] },
  async () => { if (!await checkAdbAvailable()) return '❌ ADB not available.'; await runTerminalTool({ command: 'adb shell input keyevent KEYCODE_HOME' }); return 'Home pressed'; }
);

export const androidMenu = at('android_menu', 'Press the Android menu button',
  { type: 'object', properties: {}, required: [] },
  async () => { if (!await checkAdbAvailable()) return '❌ ADB not available.'; await runTerminalTool({ command: 'adb shell input keyevent KEYCODE_MENU' }); return 'Menu pressed'; }
);
