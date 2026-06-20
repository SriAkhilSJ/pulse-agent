// packages/frontend/src/vite-env.d.ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WS_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare global {
  interface Window {
    electronAPI?: {
      chat: (message: string, sessionId: string) => Promise<any>;
    };
  }
}
