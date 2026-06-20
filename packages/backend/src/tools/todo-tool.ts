// packages/backend/src/tools/todo-tool.ts
import { defineTool } from '../tool-registry.js';

interface TodoItem { id: string; content: string; status: 'pending' | 'in_progress' | 'completed' | 'cancelled'; }
let todos: TodoItem[] = [];

export const todoTool = defineTool('todo', 'Manage todo list', {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['list', 'add', 'update', 'clear'] },
    id: { type: 'string' },
    content: { type: 'string' },
    status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'cancelled'] },
  },
  required: ['action'],
}, async (args: Record<string, unknown>) => {
  const action = String(args.action);
  if (action === 'list') return todos.map(t => `[${t.status}] ${t.id}: ${t.content}`).join('\n') || 'No todos';
  if (action === 'add') {
    const item: TodoItem = { id: String(Date.now()), content: String(args.content || ''), status: 'pending' };
    todos.push(item);
    return `Added: ${item.content}`;
  }
  if (action === 'update') {
    const item = todos.find(t => t.id === args.id);
    if (item && args.status) item.status = args.status as TodoItem['status'];
    return `Updated ${args.id}`;
  }
  if (action === 'clear') { todos = []; return 'Cleared'; }
  return 'Unknown action';
});
