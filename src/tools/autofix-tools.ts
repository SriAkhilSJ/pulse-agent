// src/tools/autofix-tools.ts
import { defineTool } from '../tool-registry';

export const autoFixBuildTool = defineTool(
  'auto_fix_build',
  'Auto-fix build errors by analyzing the error output and applying fixes',
  { type: 'object', properties: {}, required: [] },
  async (): Promise<string> => {
    return 'Auto-fix build: Analyze the build errors first using parse_build_errors, then apply fixes manually.';
  }
);

export const quickFixLintTool = defineTool(
  'quick_fix_lint',
  'Quick-fix lint errors using the linter\'s auto-fix capability',
  { type: 'object', properties: {}, required: [] },
  async (): Promise<string> => {
    return 'Quick-fix lint: Run the linter with --fix flag to auto-fix lint errors.';
  }
);
