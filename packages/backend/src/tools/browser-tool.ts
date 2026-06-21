// packages/backend/src/tools/browser-tool.ts
// Puppeteer browser automation — navigate, click, type, screenshot

import { defineTool } from '../tool-registry.js';
import puppeteer, { Browser, Page } from 'puppeteer';

let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browser) {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  }
  return browser;
}

async function getPage(): Promise<Page> {
  const b = await getBrowser();
  const pages = await b.pages();
  return pages[0] || await b.newPage();
}

export async function initBrowserTools() {
  return [
    defineTool('browser_navigate', 'Navigate to a URL in the browser', {
      type: 'object' as const,
      properties: { url: { type: 'string', description: 'The URL to navigate to' } },
      required: ['url'],
    }, async (args: Record<string, unknown>) => {
      const url = String(args.url);
      const page = await getPage();
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      const title = await page.title();
      return `Navigated to ${url} — Title: ${title}`;
    }),

    defineTool('browser_click', 'Click an element on the page', {
      type: 'object' as const,
      properties: { selector: { type: 'string', description: 'CSS selector of the element' } },
      required: ['selector'],
    }, async (args: Record<string, unknown>) => {
      const selector = String(args.selector);
      const page = await getPage();
      await page.click(selector);
      return `Clicked: ${selector}`;
    }),

    defineTool('browser_type', 'Type text into an input field', {
      type: 'object' as const,
      properties: {
        selector: { type: 'string', description: 'CSS selector of the input' },
        text: { type: 'string', description: 'Text to type' },
      },
      required: ['selector', 'text'],
    }, async (args: Record<string, unknown>) => {
      const selector = String(args.selector);
      const text = String(args.text);
      const page = await getPage();
      await page.type(selector, text, { delay: 50 });
      return `Typed "${text}" into ${selector}`;
    }),

    defineTool('browser_screenshot', 'Take a screenshot of the current page', {
      type: 'object' as const,
      properties: { fullPage: { type: 'boolean', description: 'Capture full page (default: false)' } },
      required: [],
    }, async (args: Record<string, unknown>) => {
      const fullPage = Boolean(args.fullPage);
      const page = await getPage();
      const screenshot = await page.screenshot({ fullPage, encoding: 'base64' }) as string;
      return `Screenshot captured (base64, ${screenshot.length} chars)`;
    }),

    defineTool('browser_get_text', 'Get text content of an element', {
      type: 'object' as const,
      properties: { selector: { type: 'string', description: 'CSS selector' } },
      required: ['selector'],
    }, async (args: Record<string, unknown>) => {
      const selector = String(args.selector);
      const page = await getPage();
      const text = await page.$eval(selector, (el) => el.textContent);
      return text || '';
    }),

    defineTool('browser_scroll', 'Scroll the page', {
      type: 'object' as const,
      properties: {
        direction: { type: 'string', enum: ['up', 'down', 'top', 'bottom'], description: 'Scroll direction' },
      },
      required: ['direction'],
    }, async (args: Record<string, unknown>) => {
      const direction = String(args.direction);
      const page = await getPage();
      switch (direction) {
        case 'up': await page.evaluate(() => (globalThis as any).scrollBy(0, -500)); break;
        case 'down': await page.evaluate(() => (globalThis as any).scrollBy(0, 500)); break;
        case 'top': await page.evaluate(() => (globalThis as any).scrollTo(0, 0)); break;
        case 'bottom': await page.evaluate(() => (globalThis as any).scrollTo(0, (globalThis as any).document.body.scrollHeight)); break;
      }
      return `Scrolled ${direction}`;
    }),
  ];
}

// Cleanup on exit
process.on('exit', async () => {
  if (browser) await browser.close();
});
