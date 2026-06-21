// packages/frontend/src/vite-env.d.ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WS_URL: string;
  readonly VITE_SSE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

export {};

declare global {
  interface Window {
    electronAPI: {
      // File system
      openFolder: () => Promise<string | null>;
      readDirectory: (path: string, depth?: number) => Promise<any[]>;
      readFile: (path: string) => Promise<string>;
      writeFile: (path: string, content: string) => Promise<{ success: boolean; error?: string }>;
      deleteFile: (path: string) => Promise<{ success: boolean; error?: string }>;
      createFile: (path: string) => Promise<{ success: boolean; error?: string }>;
      createFolder: (path: string) => Promise<{ success: boolean; error?: string }>;
      rename: (oldPath: string, newPath: string) => Promise<{ success: boolean; error?: string }>;
      exists: (path: string) => Promise<boolean>;
      getStats: (path: string) => Promise<any>;
      // App
      getAppVersion: () => Promise<string>;
      getPlatform: () => string;
      // Chat (legacy)
      chat: (message: string, sessionId: string) => Promise<any>;
    };
  }
}
