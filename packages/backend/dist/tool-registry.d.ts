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
export declare function defineTool(name: string, description: string, parameters: {
    type: 'object';
    properties: Record<string, ToolProperty>;
    required: string[];
}, handler: ToolHandler): ToolHandlerWithSchema;
export declare class ToolRegistry {
    private tools;
    register(def: ToolDefinition | ((args: Record<string, unknown>) => Promise<string>)): void;
    remove(name: string): boolean;
    update(def: ToolDefinition): boolean;
    has(name: string): boolean;
    execute(name: string, args: Record<string, unknown>): Promise<string>;
    getToolsSchema(): object[];
    getToolNames(): string[];
}
//# sourceMappingURL=tool-registry.d.ts.map