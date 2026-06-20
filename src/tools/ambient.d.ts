// src/tools/ambient.d.ts
// Ambient declarations for optional dependencies that may not be installed.

declare module 'playwright' {
  export interface Browser {
    newContext(): Promise<BrowserContext>;
    close(): Promise<void>;
  }
  export interface BrowserContext {
    newPage(): Promise<Page>;
  }
  export interface Page {
    goto(url: string, options?: any): Promise<void>;
    click(selector: string, options?: any): Promise<void>;
    fill(selector: string, text: string): Promise<void>;
    screenshot(options?: any): Promise<Buffer>;
    textContent(selector: string): Promise<string | null>;
    title(): Promise<string>;
  }
  export const chromium: {
    launch(options?: any): Promise<Browser>;
  };
}
