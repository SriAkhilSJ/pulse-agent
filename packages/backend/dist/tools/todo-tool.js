"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.todoTool = void 0;
// packages/backend/src/tools/todo-tool.ts
const tool_registry_js_1 = require("../tool-registry.js");
let todos = [];
exports.todoTool = (0, tool_registry_js_1.defineTool)('todo', 'Manage todo list', {
    type: 'object',
    properties: {
        action: { type: 'string', enum: ['list', 'add', 'update', 'clear'] },
        id: { type: 'string' },
        content: { type: 'string' },
        status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'cancelled'] },
    },
    required: ['action'],
}, async (args) => {
    const action = String(args.action);
    if (action === 'list')
        return todos.map(t => `[${t.status}] ${t.id}: ${t.content}`).join('\n') || 'No todos';
    if (action === 'add') {
        const item = { id: String(Date.now()), content: String(args.content || ''), status: 'pending' };
        todos.push(item);
        return `Added: ${item.content}`;
    }
    if (action === 'update') {
        const item = todos.find(t => t.id === args.id);
        if (item && args.status)
            item.status = args.status;
        return `Updated ${args.id}`;
    }
    if (action === 'clear') {
        todos = [];
        return 'Cleared';
    }
    return 'Unknown action';
});
//# sourceMappingURL=todo-tool.js.map