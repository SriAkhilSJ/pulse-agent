// packages/shared/types/router.types.ts
// Smart Router — decides routing strategy for user queries

export enum RouteType {
  AUTOCOMPLETE = 'autocomplete',
  SINGLE_CALL = 'single_call',
  MULTI_CALL = 'multi_call',
}

export interface RouteContext {
  query: string;
  currentFileContent: string;
  cursorPosition: number; // character offset
  activeFilePath: string;
  workspaceFiles: string[]; // list of file paths
  recentEdits: string[];
  conversationHistoryLength: number;
}

export interface RouteDecision {
  type: RouteType;
  reason: string;
  confidence: number; // 0-1
}
