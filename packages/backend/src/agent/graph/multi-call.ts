// packages/backend/src/agent/graph/multi-call.ts
// LangGraph Multi-Call Agent — ReAct loop with validation and checkpointing

import type { AgentState, AgentConfig, FileDiff, ValidationResult } from '@pulse-ide/shared';

// ---------------------------------------------------------------------------
// Simplified LangGraph-compatible agent (works without full LC dependency issues)
// ---------------------------------------------------------------------------

/** Plan: generate a step-by-step plan from the query */
function plan(query: string): string[] {
  // Simple heuristic planner — in production this would use an LLM
  const steps: string[] = [];

  if (query.toLowerCase().includes('rename')) {
    const fileMatch = query.match(/(\w+\.(?:ts|js|py|java|go|rs|rb|php|md|json|yaml|yml|html|css))/i);
    const variableMatch = query.match(/variable\s+['"]?(\w+)['"]?/i) || query.match(/`(\w+)`/);
    const newNameMatch = query.match(/to\s+['"]?(\w+)['"]?/i);

    if (fileMatch) steps.push(`Read file ${fileMatch[1]}`);
    if (variableMatch && newNameMatch) {
      steps.push(`Replace '${variableMatch[1]}' with '${newNameMatch[1]}'`);
    }
    if (fileMatch) steps.push(`Edit file ${fileMatch[1]}`);
    steps.push('Verify the change');
  } else if (query.toLowerCase().includes('read') || query.toLowerCase().includes('search')) {
    steps.push('Read relevant files');
    steps.push('Search codebase');
    steps.push('Provide results');
  } else {
    steps.push('Analyze the request');
    steps.push('Read relevant files');
    steps.push('Execute the task');
    steps.push('Verify the result');
  }

  return steps;
}

/** Validate tool output (stub — Tree-sitter integration later) */
export function validateOutput(toolName: string, output: string, args: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (output.startsWith('Error') || output.startsWith('error')) {
    errors.push(`Tool "${toolName}" returned an error: ${output}`);
  }

  if (toolName === 'write_file' && args.content === '') {
    warnings.push('Writing empty content to file');
  }

  if (toolName === 'edit_file' && output.includes('Text not found')) {
    errors.push('Edit failed: old_text not found in file');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/** Execute a single step and return the result */
function executeStep(step: string, state: { filesRead: string[]; fileChanges: FileDiff[] }): { output: string; newState: typeof state } {
  const newState = { ...state, filesRead: [...state.filesRead], fileChanges: [...state.fileChanges] };

  // Simulate tool execution based on step description
  if (step.startsWith('Read file')) {
    const filePath = step.replace('Read file ', '').trim();
    newState.filesRead.push(filePath);
    return { output: `[Mock] Read ${filePath}: const user = { name: 'test' };`, newState };
  }

  if (step.startsWith('Edit file') || step.includes('Replace')) {
    const fileMatch = step.match(/(\w+\.(?:ts|js|py|java|go|rs|rb|php|md|json|yaml|yml|html|css))/i);
    const filePath = fileMatch ? fileMatch[1] : 'unknown.ts';
    const oldContent = "const user = { name: 'test' };";
    const newContent = "const customer = { name: 'test' };";
    newState.fileChanges.push({
      filePath,
      oldContent,
      newContent,
      hunks: [{
        oldStart: 1,
        oldLines: 1,
        newStart: 1,
        newLines: 1,
        lines: [`-${oldContent}`, `+${newContent}`],
      }],
    });
    return { output: `[Mock] Edited ${filePath}: replaced 'user' with 'customer'`, newState };
  }

  if (step === 'Verify the change' || step.includes('Verify')) {
    return { output: '[Mock] Verification passed: no errors found', newState };
  }

  if (step === 'Search codebase') {
    return { output: '[Mock] Found 3 matches across 2 files', newState };
  }

  return { output: `[Mock] Executed: ${step}`, newState };
}

/** Run the full ReAct loop */
export function runMultiCallAgent(query: string, config: Partial<AgentConfig> = {}): AgentState {
  const maxIterations = config.maxIterations || 10;
  const currentState: AgentState = {
    messages: [],
    currentPlan: [],
    completedSteps: [],
    filesRead: [],
    fileChanges: [],
    validationErrors: [],
    iteration: 0,
    maxIterations,
    needsUserApproval: false,
    query,
    status: 'idle',
  };

  // Plan
  currentState.status = 'planning';
  currentState.currentPlan = plan(query);
  currentState.messages.push({
    role: 'assistant',
    content: `Plan:\n${currentState.currentPlan.map((s, i) => `${i + 1}. ${s}`).join('\n')}`,
    timestamp: Date.now(),
  });

  // Execute
  currentState.status = 'executing';
  let executionState = { filesRead: [] as string[], fileChanges: [] as FileDiff[] };

  for (let i = 0; i < Math.min(currentState.currentPlan.length, maxIterations); i++) {
    const step = currentState.currentPlan[i];
    currentState.iteration = i + 1;

    // Execute step
    const { output, newState } = executeStep(step, executionState);
    executionState = newState;

    // Validate
    currentState.status = 'validating';
    const validation = validateOutput('mock', output, {});

    if (!validation.valid) {
      currentState.validationErrors.push(...validation.errors);
      currentState.status = 'error';
      currentState.error = validation.errors.join('; ');

      // Retry: add correction step
      currentState.currentPlan.splice(i + 1, 0, `Retry: ${step}`);
      continue;
    }

    currentState.completedSteps.push(step);
    currentState.filesRead = newState.filesRead;
    currentState.fileChanges = newState.fileChanges;
    currentState.status = 'executing';
  }

  // Done
  currentState.status = 'done';
  currentState.messages.push({
    role: 'assistant',
    content: `Completed ${currentState.completedSteps.length} steps. Files read: ${currentState.filesRead.join(', ') || 'none'}. Files modified: ${currentState.fileChanges.map(f => f.filePath).join(', ') || 'none'}.`,
    timestamp: Date.now(),
  });

  return currentState;
}

/** Create a multi-call agent (factory function) */
export function createMultiCallAgent(config: AgentConfig) {
  return {
    run: (query: string) => runMultiCallAgent(query, config),
    config,
  };
}

export type { AgentState, AgentConfig, ValidationResult };
