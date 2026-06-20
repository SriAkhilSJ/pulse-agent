// packages/shared/types/validation.types.ts
// AST & LSP Validation types

export interface ValidationError {
  line: number;
  column: number;
  message: string;
  severity: 'error' | 'warning' | 'info';
  source: 'ast' | 'lsp';
}

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  fixedContent?: string;
}

export type SupportedLanguage =
  | 'typescript'
  | 'javascript'
  | 'python'
  | 'rust'
  | 'go'
  | 'java'
  | 'unknown';

export function getLanguageFromFilePath(filePath: string): SupportedLanguage {
  const ext = filePath.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'ts':
    case 'tsx':
      return 'typescript';
    case 'js':
    case 'jsx':
      return 'javascript';
    case 'py':
      return 'python';
    case 'rs':
      return 'rust';
    case 'go':
      return 'go';
    case 'java':
      return 'java';
    default:
      return 'unknown';
  }
}
