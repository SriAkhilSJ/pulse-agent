// packages/backend/src/tool-registry.ts
// Tool registry: register, remove, update, execute, and get schemas for all tools.

import type { ToolHandler, ToolProperty, ToolDefinition } from '@pulse-ide/shared';

/** Attach schema metadata to a tool function */
export interface ToolHandlerWithSchema extends ToolHandler {
  __toolName?: string;
  __toolDescription?: string;
  __toolParameters?: {
    type: 'object';
    properties: Record<string, ToolProperty>;
    required: string[];
  };
}

export type { ToolHandler, ToolProperty, ToolDefinition };

export function defineTool(
  name: string,
  description: string,
  parameters: { type: 'object'; properties: Record<string, ToolProperty>; required: string[] },
  handler: ToolHandler,
): ToolHandlerWithSchema {
  const fn = handler as ToolHandlerWithSchema;
  fn.__toolName = name;
  fn.__toolDescription = description;
  fn.__toolParameters = parameters;
  return fn;
}

export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();

  register(def: ToolDefinition | ((args: Record<string, unknown>) => Promise<string>)): void {
    if (typeof def === 'function') {
      const fn = def as ToolHandlerWithSchema;
      const name = fn.__toolName || fn.name;
      const description = fn.__toolDescription || `Tool: ${name}`;
      const parameters = fn.__toolParameters || autoSchema(name, fn);
      def = { name, description, parameters, handler: fn };
    }
    this.tools.set((def as ToolDefinition).name, def as ToolDefinition);
  }

  remove(name: string): boolean {
    return this.tools.delete(name);
  }

  update(def: ToolDefinition): boolean {
    if (!this.tools.has(def.name)) return false;
    this.tools.set(def.name, def);
    return true;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  async execute(name: string, args: Record<string, unknown>): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Tool "${name}" not found. Available: ${this.getToolNames().join(', ')}`);
    const start = Date.now();
    try {
      const result = await tool.handler(args);
      const elapsed = Date.now() - start;
      console.log('[TOOL] EXEC_DONE', JSON.stringify({ toolName: name, elapsedMs: elapsed, resultLen: result.length }));
      return result;
    } catch (err) {
      const elapsed = Date.now() - start;
      console.log('[TOOL] EXEC_ERROR', JSON.stringify({ toolName: name, elapsedMs: elapsed, error: (err as Error).message }));
      throw err;
    }
  }

  getToolsSchema(): object[] {
    return Array.from(this.tools.values()).map(t => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
  }

  getToolNames(): string[] { return Array.from(this.tools.keys()); }
}

function autoSchema(name: string, fn: ToolHandlerWithSchema): {
  type: 'object';
  properties: Record<string, ToolProperty>;
  required: string[];
} {
  const src = fn.toString();
  const params: Record<string, ToolProperty> = {};
  const required: string[] = [];
  const match = src.match(/(?:\s+)?(?:function\s+\w+\s*)?\((\w+)(?:\s*:\s*[^)]+)?\)/);
  if (match) {
    const paramName = match[1];
    if (paramName !== 'args' && paramName !== '_' && paramName !== 'arguments') {
      params[paramName] = { type: 'string', description: paramName };
      required.push(paramName);
    }
  }
  return { type: 'object', properties: params, required };
}
