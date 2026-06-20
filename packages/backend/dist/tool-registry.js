"use strict";
// packages/backend/src/tool-registry.ts
// Tool registry: register, remove, update, execute, and get schemas for all tools.
Object.defineProperty(exports, "__esModule", { value: true });
exports.ToolRegistry = void 0;
exports.defineTool = defineTool;
function defineTool(name, description, parameters, handler) {
    const fn = handler;
    fn.__toolName = name;
    fn.__toolDescription = description;
    fn.__toolParameters = parameters;
    return fn;
}
class ToolRegistry {
    tools = new Map();
    register(def) {
        if (typeof def === 'function') {
            const fn = def;
            const name = fn.__toolName || fn.name;
            const description = fn.__toolDescription || `Tool: ${name}`;
            const parameters = fn.__toolParameters || autoSchema(name, fn);
            def = { name, description, parameters, handler: fn };
        }
        this.tools.set(def.name, def);
    }
    remove(name) {
        return this.tools.delete(name);
    }
    update(def) {
        if (!this.tools.has(def.name))
            return false;
        this.tools.set(def.name, def);
        return true;
    }
    has(name) {
        return this.tools.has(name);
    }
    async execute(name, args) {
        const tool = this.tools.get(name);
        if (!tool)
            throw new Error(`Tool "${name}" not found. Available: ${this.getToolNames().join(', ')}`);
        const start = Date.now();
        try {
            const result = await tool.handler(args);
            const elapsed = Date.now() - start;
            console.log('[TOOL] EXEC_DONE', JSON.stringify({ toolName: name, elapsedMs: elapsed, resultLen: result.length }));
            return result;
        }
        catch (err) {
            const elapsed = Date.now() - start;
            console.log('[TOOL] EXEC_ERROR', JSON.stringify({ toolName: name, elapsedMs: elapsed, error: err.message }));
            throw err;
        }
    }
    getToolsSchema() {
        return Array.from(this.tools.values()).map(t => ({
            type: 'function',
            function: { name: t.name, description: t.description, parameters: t.parameters },
        }));
    }
    getToolNames() { return Array.from(this.tools.keys()); }
}
exports.ToolRegistry = ToolRegistry;
function autoSchema(name, fn) {
    const src = fn.toString();
    const params = {};
    const required = [];
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
//# sourceMappingURL=tool-registry.js.map