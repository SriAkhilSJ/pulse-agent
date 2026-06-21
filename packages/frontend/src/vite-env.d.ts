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
    electronAPI?: {
      chat: (message: string, sessionId: string) => Promise<any>;
    };
  }
}
