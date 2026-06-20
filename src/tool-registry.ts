// src/tool-registry.ts
// Tool registry: register, remove, update, execute, and get schemas for all tools.

export interface ToolHandler {
  (args: Record<string, unknown>): Promise<string>;
}

/** Attach schema metadata to a tool function so the registry can auto-registry it */
export interface ToolHandlerWithSchema extends ToolHandler {
  __toolName?: string;
  __toolDescription?: string;
  __toolParameters?: {
    type: 'object';
    properties: Record<string, ToolProperty>;
    required: string[];
  };
}

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

export interface ToolProperty {
  type: string;
  description?: string;
  items?: { type: string; maxItems?: number };
  enum?: string[];
  maxItems?: number;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, ToolProperty>;
    required: string[];
  };
  handler: ToolHandler;
}

export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();

  register(def: ToolDefinition | ((args: Record<string, unknown>) => Promise<string>)): void {
    if (typeof def === 'function') {
      const fn = def as ToolHandlerWithSchema;
      // Use explicit schema if attached via defineTool
      const name = fn.__toolName || fn.name;
      const description = fn.__toolDescription || `Tool: ${name}`;
      const parameters = fn.__toolParameters || autoSchema(name, fn);
      def = { name, description, parameters, handler: fn };
    }
    this.tools.set((def as ToolDefinition).name, def as ToolDefinition);
  }

  /** Remove a tool by name */
  remove(name: string): boolean {
    return this.tools.delete(name);
  }

  /** Update an existing tool (re-register with new definition) */
  update(def: ToolDefinition): boolean {
    if (!this.tools.has(def.name)) return false;
    this.tools.set(def.name, def);
    return true;
  }

  /** Check if a tool exists */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  async execute(name: string, args: Record<string, unknown>): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error('Tool "' + name + '" not found. Available: ' + this.getToolNames().join(', '));
    const start = Date.now();
    try {
      const result = await tool.handler(args);
      const elapsed = Date.now() - start;
      console.log('[TOOL][Registry] EXEC_DONE', JSON.stringify({ toolName: name, elapsedMs: elapsed, resultLen: result.length, argKeys: Object.keys(args) }));
      return result;
    } catch (err) {
      const elapsed = Date.now() - start;
      console.log('[TOOL][Registry] EXEC_ERROR', JSON.stringify({ toolName: name, elapsedMs: elapsed, error: (err as Error).message, argKeys: Object.keys(args) }));
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

/** Auto-generate a minimal schema from a tool function's source */
function autoSchema(name: string, fn: ToolHandlerWithSchema): {
  type: 'object';
  properties: Record<string, ToolProperty>;
  required: string[];
} {
  // Try to extract parameter names from function signature
  const src = fn.toString();
  const params: Record<string, ToolProperty> = {};
  const required: string[] = [];

  // Match: async function name(args: Record<string, unknown>) or async (args) =>
  const match = src.match(/(?:async\s+)?(?:function\s+\w+\s*)?\((\w+)(?:\s*:\s*[^)]+)?\)/);
  if (match) {
    const paramName = match[1];
    if (paramName !== 'args' && paramName !== '_' && paramName !== 'arguments') {
      // Named parameter — treat as single string param
      params[paramName] = { type: 'string', description: paramName };
      required.push(paramName);
    }
  }

  // If the function destructures args, we can't easily parse that
  // Return empty schema — the model will figure it out from context
  return { type: 'object', properties: params, required };
}
