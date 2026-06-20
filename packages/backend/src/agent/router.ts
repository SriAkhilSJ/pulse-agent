// packages/backend/src/agent/router.ts
// Smart Router — decides whether a query goes to Autocomplete, Single-Call, or Multi-Call

import type { RouteContext, RouteDecision } from '@pulse-ide/shared';
import { RouteType } from '@pulse-ide/shared';

// Keywords that suggest multi-call (complex, multi-file, or ambiguous tasks)
const MULTI_CALL_KEYWORDS = [
  'refactor',
  'implement',
  'create new',
  'search codebase',
  'change all',
  'multi-file',
  'multifile',
  'across files',
  'across the project',
  'in all files',
  'rename all',
  'migrate',
  'restructure',
  'reorganize',
  'add tests for',
  'write tests',
  'debug',
  'investigate',
  'analyze',
  'review',
  'optimize',
  'clean up',
  'set up',
  'setup',
  'initialize',
  'scaffold',
  'generate',
  'build a',
  'build an',
  'create a',
  'create an',
  'add a',
  'add an',
  'new feature',
  'new page',
  'new component',
  'new module',
  'new system',
  'new api',
  'new endpoint',
  'authentication',
  'authorization',
  'login system',
  'signup',
  'dashboard',
  'full stack',
  'fullstack',
  'end to end',
  'e2e',
];

// File extension pattern for detecting file mentions
const FILE_EXTENSION_PATTERN = /\b[\w\-./]+\.(ts|tsx|js|jsx|py|java|c|cpp|cs|go|rs|rb|php|md|json|yaml|yml|xml|html|css|scss|sh|bash|zsh|ps1|sql)\b/i;

// Pattern for detecting specific file references like "fix auth.ts" or "update config"
const SPECIFIC_FILE_PATTERN = /(?:fix|update|edit|modify|change|check|review|look at|in|inside|open)\s+[\w\-./]+\.(ts|tsx|js|jsx|py|java|c|cpp|cs|go|rs|rb|php|md|json|yaml|yml|xml|html|css|scss|sh|bash|zsh|ps1|sql)/i;

/**
 * Count words in a string
 */
function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Check if cursor is at end of line (for autocomplete detection)
 */
function isCursorAtEndOfLine(content: string, cursorPosition: number): boolean {
  if (cursorPosition >= content.length) return true;
  const charAtCursor = content[cursorPosition];
  return charAtCursor === '\n' || charAtCursor === undefined;
}

/**
 * Main routing function
 *
 * Rules (in priority order):
 * 1. Multi Call: contains multi-call keywords (highest priority — catches complex tasks early)
 * 2. Single Call: mentions specific file OR short clear instruction
 * 3. Autocomplete: query < 15 chars, no ?, cursor at end of line, looks like code
 * 4. Default: MULTI_CALL for safety
 */
export function route(context: RouteContext): RouteDecision {
  const { query, currentFileContent, cursorPosition, workspaceFiles } = context;
  const queryLength = query.length;
  const words = wordCount(query);
  const queryLower = query.toLowerCase();

  // Rule 1: Multi Call — check keywords first (highest priority)
  const hasMultiKeyword = MULTI_CALL_KEYWORDS.some(kw => queryLower.includes(kw));
  if (hasMultiKeyword) {
    return {
      type: RouteType.MULTI_CALL,
      reason: 'Query contains multi-call keyword — complex task requiring multiple steps',
      confidence: 0.8,
    };
  }

  // Rule 2: Single Call
  // Mentions a specific file OR short clear instruction
  const hasSpecificFile = SPECIFIC_FILE_PATTERN.test(query) || FILE_EXTENSION_PATTERN.test(query);
  const hasClearInstruction = words < 50 && /^(fix|update|edit|modify|change|add|remove|delete|rename|move|create|write|implement)\s/i.test(query);

  if (hasSpecificFile || hasClearInstruction) {
    return {
      type: RouteType.SINGLE_CALL,
      reason: hasSpecificFile
        ? 'Query mentions a specific file — targeted single-file operation'
        : 'Short, clear instruction — single LLM call should suffice',
      confidence: 0.85,
    };
  }

  // Rule 3: Autocomplete
  // Short query, no question mark, cursor at end of line, AND looks like code (has =, :, {, etc.)
  const looksLikeCode = /[=:{(\[;]/.test(query);
  if (
    queryLength < 15 &&
    !query.includes('?') &&
    isCursorAtEndOfLine(currentFileContent, cursorPosition) &&
    looksLikeCode
  ) {
    return {
      type: RouteType.AUTOCOMPLETE,
      reason: 'Short code fragment with no question mark, cursor at end of line',
      confidence: 0.9,
    };
  }

  // Rule 3b: Multi Call — large workspace + ambiguous query
  if (workspaceFiles.length > 10 && words > 20) {
    return {
      type: RouteType.MULTI_CALL,
      reason: 'Large workspace with ambiguous query — multi-call for thorough analysis',
      confidence: 0.7,
    };
  }

  // Rule 4: Default to Multi Call for safety
  return {
    type: RouteType.MULTI_CALL,
    reason: 'Default routing — multi-call is safer for unknown queries',
    confidence: 0.5,
  };
}

export type { RouteContext, RouteDecision };
