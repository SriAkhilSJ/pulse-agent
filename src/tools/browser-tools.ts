// src/tools/browser-tools.ts
// Browser automation via Playwright.

import * as vscode from 'vscode';
import { defineTool } from '../tool-registry';
import { config } from '../config';
import * as path from 'path';
import * as fs from 'fs';

let browserInstance: any = null;
let browserCtx: any = null;
let currentPage: any = null;
let playwrightAvailable = false;

function delay(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

try {
  (require as any).resolve('playwright');
  playwrightAvailable = true;
} catch { /* graceful degradation */ }

async function ensureBrowser(headless = true): Promise<{ browser: any; context: any; page: any }> {
  if (currentPage) {
    try { await currentPage.evaluate(() => true); return { browser: browserInstance, context: browserCtx, page: currentPage }; } catch { browserInstance = null; browserCtx = null; currentPage = null; }
  }
  if (!playwrightAvailable) throw new Error('Playwright not installed.\nRun: npm install playwright\nThen: npx playwright install chromium');
  try {
    const pw = await import('playwright');
    browserInstance = await pw.chromium.launch({ headless });
    browserCtx = await browserInstance.newContext({ viewport: { width: 1280, height: 800 }, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0' });
    currentPage = await browserCtx.newPage();
    currentPage.on('pageerror', (err: Error) => console.error('[Browser] Page error:', err.message));
    return { browser: browserInstance, context: browserCtx, page: currentPage };
  } catch (err: any) { playwrightAvailable = false; throw new Error('Browser launch failed: ' + err.message + '\nRun: npx playwright install chromium'); }
}

function getScreenshotDir(): string {
  const wf = vscode.workspace.workspaceFolders;
  const base = wf ? wf[0].uri.fsPath : process.cwd();
  const dir = path.join(base, '.pulse', 'screenshots');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function takeScreenshot(page: any, name: string): Promise<string> {
  const dir = getScreenshotDir();
  const filePath = path.join(dir, name + '.png');
  await page.screenshot({ path: filePath, fullPage: false });
  return filePath;
}

// Helper to wrap browser tool handlers
const browserTool = (name: string, desc: string, params: any, handler: (args: Record<string, unknown>) => Promise<string>) => defineTool(name, desc, params, handler);

export const browserNavigate = browserTool(
  'browser_navigate', 'Navigate to a URL in the browser',
  { type: 'object', properties: { url: { type: 'string', description: 'URL to navigate to' } }, required: ['url'] },
  async (args) => {
    const url = args.url as string;
    if (!url) throw new Error('browser_navigate requires "url"');
    const { page } = await ensureBrowser();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: config.browserTimeoutMs });
    const ss = await takeScreenshot(page, 'navigate-' + Date.now());
    const title = await page.title();
    const snippet = await page.evaluate(() => { const b = (globalThis as any).document?.body; return b?.innerText?.substring(0, 200) || ''; });
    return 'Navigated to ' + url + '\nTitle: ' + title + '\nPreview: ' + snippet + '\nScreenshot: ' + ss;
  }
);

export const browserFind = browserTool(
  'browser_find', 'Find an element on the page by text',
  { type: 'object', properties: { text: { type: 'string', description: 'Text to search for' } }, required: ['text'] },
  async (args) => {
    const text = args.text as string;
    if (!text) throw new Error('browser_find requires "text"');
    const { page } = await ensureBrowser();
    const strategies = [
      () => page.getByText(text, { exact: false }).first(),
      () => page.getByRole('button', { name: text, exact: false }).first(),
      () => page.getByRole('link', { name: text, exact: false }).first(),
      () => page.getByRole('textbox', { name: text, exact: false }).first(),
      () => page.getByLabel(text, { exact: false }).first(),
      () => page.getByPlaceholder(text, { exact: false }).first(),
      () => page.locator(`text=${text}`).first(),
    ];
    for (const strategy of strategies) {
      try { const el = await strategy(); if (el) { const box = await el.boundingBox(); const tagName = await el.evaluate((e: any) => e.tagName.toLowerCase()); const name = await el.textContent() || ''; return JSON.stringify({ found: true, tagName, text: name.substring(0, 100), boundingBox: box, selector: `text=${text}` }, null, 2); } } catch { /* try next */ }
    }
    return JSON.stringify({ found: false, text });
  }
);

export const browserClick = browserTool(
  'browser_click', 'Click an element on the page',
  { type: 'object', properties: { selector: { type: 'string', description: 'CSS selector or text to click' } }, required: ['selector'] },
  async (args) => {
    const selector = args.selector as string;
    if (!selector) throw new Error('browser_click requires "selector"');
    const { page } = await ensureBrowser();
    let elementText = '';
    try { const el = await page.$(selector); if (el) elementText = (await el.innerText()).substring(0, 50).trim(); } catch { /* ignore */ }
    await page.click(selector, { timeout: config.browserTimeoutMs });
    await delay(500);
    const ss = await takeScreenshot(page, 'click-' + Date.now());
    const desc = elementText ? ' "' + elementText + '"' : '';
    return 'Clicked: ' + selector + desc + '\nScreenshot: ' + ss;
  }
);

export const browserType = browserTool(
  'browser_type', 'Type text into an element',
  { type: 'object', properties: { selector: { type: 'string', description: 'CSS selector of the input' }, text: { type: 'string', description: 'Text to type' } }, required: ['selector', 'text'] },
  async (args) => {
    const selector = args.selector as string;
    const text = args.text as string;
    if (!selector || text === undefined) throw new Error('browser_type requires "selector" + "text"');
    const { page } = await ensureBrowser();
    await page.click(selector, { timeout: 10_000 });
    await page.fill(selector, '');
    await page.type(selector, text, { delay: 30 });
    const ss = await takeScreenshot(page, 'type-' + Date.now());
    return 'Typed "' + text.substring(0, 60) + '" into ' + selector + '\nScreenshot: ' + ss;
  }
);

export const browserFormFill = browserTool(
  'browser_form_fill', 'Fill multiple form fields',
  { type: 'object', properties: { fields: { type: 'object', description: 'Object mapping selectors to values' } }, required: ['fields'] },
  async (args) => {
    const fields = args.fields as Record<string, string>;
    if (!fields) throw new Error('browser_form_fill requires "fields" object');
    const { page } = await ensureBrowser();
    const results: string[] = [];
    for (const [selector, value] of Object.entries(fields)) {
      try { await page.click(selector, { timeout: config.browserTimeoutMs }); await page.fill(selector, ''); await page.type(selector, value, { delay: 30 }); results.push('✓ ' + selector + ' = "' + value.substring(0, 30) + '"'); } catch (err) { results.push('✗ ' + selector + ': ' + (err as Error).message); }
    }
    const ss = await takeScreenshot(page, 'form-' + Date.now());
    return 'Form filled:\n' + results.join('\n') + '\nScreenshot: ' + ss;
  }
);

export const browserWait = browserTool(
  'browser_wait', 'Wait for an element, text, URL, or time',
  { type: 'object', properties: { selector: { type: 'string', description: 'CSS selector to wait for' }, text: { type: 'string', description: 'Text to wait for on page' }, url: { type: 'string', description: 'URL pattern to wait for' }, timeout: { type: 'number', description: 'Timeout in ms' }, ms: { type: 'number', description: 'Milliseconds to wait' } }, required: [] },
  async (args) => {
    const { page } = await ensureBrowser();
    const selector = args.selector as string;
    const timeout = (args.timeout as number) || 10_000;
    if (selector) { await page.waitForSelector(selector, { timeout, state: 'visible' }); const ss = await takeScreenshot(page, 'wait-' + Date.now()); return 'Waited for: ' + selector + ' (visible)\nScreenshot: ' + ss; }
    const text = args.text as string;
    if (text) { await page.waitForFunction((t: string) => (globalThis as any).document.body.innerText.includes(t), text, { timeout }); const ss = await takeScreenshot(page, 'wait-' + Date.now()); return 'Waited for text: "' + text + '"\nScreenshot: ' + ss; }
    const url = args.url as string;
    if (url) { await page.waitForURL(url, { timeout }); const ss = await takeScreenshot(page, 'wait-' + Date.now()); return 'Waited for URL: ' + url + '\nScreenshot: ' + ss; }
    const ms = (args.ms as number) || 2000;
    await new Promise(r => setTimeout(r, ms));
    const ss = await takeScreenshot(page, 'wait-' + Date.now());
    return 'Waited ' + ms + 'ms\nScreenshot: ' + ss;
  }
);

export const browserScreenshot = browserTool(
  'browser_screenshot', 'Take a screenshot of the current page',
  { type: 'object', properties: { name: { type: 'string', description: 'Screenshot name (optional)' }, fullpage: { type: 'boolean', description: 'Capture full page (default: false)' } }, required: [] },
  async (args) => {
    const name = (args.name as string) || 'screenshot-' + Date.now();
    const fullPage = (args.fullpage as boolean) || false;
    const { page } = await ensureBrowser();
    const dir = getScreenshotDir();
    const filePath = path.join(dir, name.replace(/\.png$/, '') + '.png');
    await page.screenshot({ path: filePath, fullPage });
    return 'Screenshot saved: ' + filePath + '\nView: ' + filePath;
  }
);

export const browserAssertText = browserTool(
  'browser_assert_text', 'Assert that an element contains expected text',
  { type: 'object', properties: { selector: { type: 'string', description: 'CSS selector' }, expected: { type: 'string', description: 'Expected text content' } }, required: ['selector', 'expected'] },
  async (args) => {
    const selector = args.selector as string;
    const expected = args.expected as string;
    if (!selector || expected === undefined) throw new Error('browser_assert_text requires "selector" + "expected"');
    const { page } = await ensureBrowser();
    const actual = await page.textContent(selector);
    const ss = await takeScreenshot(page, 'assert-' + Date.now());
    if (actual && actual.toLowerCase().includes(expected.toLowerCase())) return 'PASS: "' + expected + '" found in ' + selector + '\nScreenshot: ' + ss;
    return 'FAIL: Expected "' + expected + '" in ' + selector + ' but got: "' + (actual || '').substring(0, 100) + '"\nScreenshot: ' + ss;
  }
);

export const browserGetText = browserTool(
  'browser_get_text', 'Get text content of an element',
  { type: 'object', properties: { selector: { type: 'string', description: 'CSS selector' } }, required: ['selector'] },
  async (args) => {
    const selector = args.selector as string;
    if (!selector) throw new Error('browser_get_text requires "selector"');
    const { page } = await ensureBrowser();
    const text = await page.textContent(selector);
    return (text || '(empty)').substring(0, 500);
  }
);

export const browserScroll = browserTool(
  'browser_scroll', 'Scroll the page',
  { type: 'object', properties: { direction: { type: 'string', description: 'Direction: up, down, left, right' }, amount: { type: 'number', description: 'Pixels to scroll (default: 500)' } }, required: ['direction'] },
  async (args) => {
    const direction = (args.direction as string) || 'down';
    const amount = (args.amount as number) || 500;
    const { page } = await ensureBrowser();
    const deltaY = direction === 'down' ? amount : direction === 'up' ? -amount : 0;
    const deltaX = direction === 'right' ? amount : direction === 'left' ? -amount : 0;
    await page.evaluate(`window.scrollBy(${deltaX}, ${deltaY})`);
    await delay(500);
    const ss = await takeScreenshot(page, 'scroll-' + Date.now());
    return 'Scrolled ' + direction + ' by ' + amount + 'px\nScreenshot: ' + ss;
  }
);

export const browserHover = browserTool(
  'browser_hover', 'Hover over an element',
  { type: 'object', properties: { selector: { type: 'string', description: 'CSS selector' } }, required: ['selector'] },
  async (args) => {
    const selector = args.selector as string;
    if (!selector) throw new Error('browser_hover requires "selector"');
    const { page } = await ensureBrowser();
    await page.hover(selector, { timeout: config.browserTimeoutMs });
    await delay(500);
    const ss = await takeScreenshot(page, 'hover-' + Date.now());
    return 'Hovered: ' + selector + '\nScreenshot: ' + ss;
  }
);

export const browserExecute = browserTool(
  'browser_execute', 'Execute JavaScript on the page',
  { type: 'object', properties: { script: { type: 'string', description: 'JavaScript expression to evaluate' } }, required: ['script'] },
  async (args) => {
    const script = args.script as string;
    if (!script) throw new Error('browser_execute requires "script"');
    const { page } = await ensureBrowser();
    try {
      const result = await page.evaluate((s: string) => {
        if (s.includes('function') || s.includes('=>') || s.includes('var ') || s.includes('let ') || s.includes('const ')) return 'Error: Only simple expressions allowed. No declarations.';
        try { return eval('(' + s + ')'); } catch (e: any) { return 'Error: ' + e.message; }
      }, script);
      return 'Executed: ' + JSON.stringify(result).substring(0, 500);
    } catch (err: any) { return 'Error executing script: ' + err.message; }
  }
);

export const browserClose = browserTool(
  'browser_close', 'Close the browser',
  { type: 'object', properties: {}, required: [] },
  async () => {
    if (browserInstance) { try { await browserInstance.close(); } catch { /* ignore */ } browserInstance = null; browserCtx = null; currentPage = null; }
    return 'Browser closed';
  }
);

export async function closeBrowser(): Promise<void> {
  if (browserInstance) { try { await browserInstance.close(); } catch { /* ignore */ } browserInstance = null; browserCtx = null; currentPage = null; }
}
