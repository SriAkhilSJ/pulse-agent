// packages/backend/src/validation/ast-validator.ts
// AST Validator — pure JS, no native dependencies
// Uses regex-based syntax checking for MVP (Tree-sitter integration later)

import type { ASTValidationResult, ValidationError, SupportedLanguage } from '@pulse-ide/shared';
import { getLanguageFromFilePath } from '@pulse-ide/shared';

// ---------------------------------------------------------------------------
// Bracket/paren matching for syntax validation
// ---------------------------------------------------------------------------
interface BracketPair {
  open: string;
  close: string;
}

const BRACKET_PAIRS: BracketPair[] = [
  { open: '(', close: ')' },
  { open: '{', close: '}' },
  { open: '[', close: ']' },
];

function checkBrackets(content: string): ValidationError[] {
  const errors: ValidationError[] = [];
  const stack: { char: string; line: number; column: number }[] = [];
  const lines = content.split('\n');

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    let inString = false;
    let stringChar = '';
    let inComment = false;

    for (let colIdx = 0; colIdx < line.length; colIdx++) {
      const char = line[colIdx];
      const prevChar = colIdx > 0 ? line[colIdx - 1] : '';

      // Handle string literals
      if (!inComment && (char === '"' || char === "'" || char === '`')) {
        if (!inString) {
          inString = true;
          stringChar = char;
        } else if (char === stringChar && prevChar !== '\\') {
          inString = false;
        }
        continue;
      }

      if (inString) continue;

      // Handle line comments
      if (!inComment && char === '/' && line[colIdx + 1] === '/') {
        inComment = true;
        continue;
      }

      if (inComment) continue;

      // Handle block comments
      if (char === '/' && line[colIdx + 1] === '*') {
        // Skip to end of block comment
        const rest = line.slice(colIdx + 2);
        const endIdx = rest.indexOf('*/');
        if (endIdx === -1) {
          inComment = true;
        } else {
          colIdx += 2 + endIdx + 1;
        }
        continue;
      }

      // Check brackets
      for (const pair of BRACKET_PAIRS) {
        if (char === pair.open) {
          stack.push({ char, line: lineIdx + 1, column: colIdx + 1 });
        } else if (char === pair.close) {
          if (stack.length === 0) {
            errors.push({
              line: lineIdx + 1,
              column: colIdx + 1,
              message: `Unexpected closing '${char}' with no matching opening`,
              severity: 'error',
              source: 'ast',
            });
          } else {
            const last = stack[stack.length - 1];
            const expected = BRACKET_PAIRS.find(p => p.open === last.char);
            if (expected && expected.close !== char) {
              errors.push({
                line: lineIdx + 1,
                column: colIdx + 1,
                message: `Mismatched bracket: expected '${expected.close}' but found '${char}' (opened at line ${last.line}, col ${last.column})`,
                severity: 'error',
                source: 'ast',
              });
            }
            stack.pop();
          }
        }
      }
    }
  }

  // Report unclosed brackets
  for (const unclosed of stack) {
    errors.push({
      line: unclosed.line,
      column: unclosed.column,
      message: `Unclosed '${unclosed.char}' — no matching closing bracket`,
      severity: 'error',
      source: 'ast',
    });
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Language-specific validation rules
// ---------------------------------------------------------------------------
function validateTypeScript(content: string): ValidationError[] {
  const errors: ValidationError[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Check for common TS issues
    if (trimmed.includes('let ') && trimmed.includes('= ;')) {
      errors.push({
        line: i + 1,
        column: line.indexOf('= ;') + 1,
        message: 'Empty assignment — missing value after "="',
        severity: 'warning',
        source: 'ast',
      });
    }

    // Check for missing semicolons after const/let assignments (simple heuristic)
    if (/^(const|let|var)\s+\w+\s*=\s*[^;{]+$/.test(trimmed) && !trimmed.endsWith('{') && !trimmed.endsWith(',')) {
      errors.push({
        line: i + 1,
        column: line.length,
        message: 'Missing semicolon at end of statement',
        severity: 'warning',
        source: 'ast',
      });
    }
  }

  return errors;
}

function validatePython(content: string): ValidationError[] {
  const errors: ValidationError[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Check for mixed tabs and spaces
    if (line.startsWith('\t') && line.includes('  ')) {
      errors.push({
        line: i + 1,
        column: 1,
        message: 'Mixed tabs and spaces for indentation',
        severity: 'warning',
        source: 'ast',
      });
    }

    // Check for missing colon after def/if/for/while/class
    if (/^(def|if|elif|else|for|while|class|try|except|with)\s+.*[^:]\s*$/.test(trimmed) && !trimmed.endsWith('\\')) {
      errors.push({
        line: i + 1,
        column: line.length,
        message: 'Missing colon at end of statement',
        severity: 'warning',
        source: 'ast',
      });
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Auto-fix simple issues
// ---------------------------------------------------------------------------
function autoFix(content: string, language: SupportedLanguage): string {
  let fixed = content;

  // Fix missing semicolons in TS/JS
  if (language === 'typescript' || language === 'javascript') {
    fixed = fixed.replace(/((?:const|let|var)\s+\w+\s*=\s*[^;{}\n,]+)(\n)/g, '$1;$2');
  }

  // Fix missing colons in Python
  if (language === 'python') {
    fixed = fixed.replace(/((?:def|if|elif|else|for|while|class|try|except|with)\s+.*[^:\s])(\n)/g, '$1:$2');
  }

  return fixed;
}

// ---------------------------------------------------------------------------
// Main validation function
// ---------------------------------------------------------------------------
export function validate(filePath: string, content: string): ASTValidationResult {
  const language = getLanguageFromFilePath(filePath);
  const errors: ValidationError[] = [];

  // Always check brackets
  errors.push(...checkBrackets(content));

  // Language-specific checks
  switch (language) {
    case 'typescript':
    case 'javascript':
      errors.push(...validateTypeScript(content));
      break;
    case 'python':
      errors.push(...validatePython(content));
      break;
    default:
      // Unknown language — just do bracket checking
      break;
  }

  const criticalErrors = errors.filter(e => e.severity === 'error');
  const isValid = criticalErrors.length === 0;

  // Attempt auto-fix if there are only warnings
  let fixedContent: string | undefined;
  if (isValid && errors.length > 0) {
    fixedContent = autoFix(content, language);
    if (fixedContent === content) {
      fixedContent = undefined; // No changes made
    }
  }

  return {
    isValid,
    errors,
    fixedContent,
  };
}
