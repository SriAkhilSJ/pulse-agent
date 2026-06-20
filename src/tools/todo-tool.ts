// src/tools/todo-tool.ts
// Plan Mode — Task list management

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { defineTool } from '../tool-registry';

export interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
}

const VALID_STATUSES: Set<string> = new Set(['pending', 'in_progress', 'completed', 'cancelled']);

function getTodoFile(): string {
  const dir = path.join(os.homedir(), '.pulse');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'todos.json');
}

function loadAllTodos(): Map<string, TodoItem[]> {
  const map = new Map<string, TodoItem[]>();
  try {
    const file = getTodoFile();
    if (fs.existsSync(file)) {
      const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
      for (const [key, val] of Object.entries(raw)) {
        if (Array.isArray(val)) map.set(key, val as TodoItem[]);
      }
    }
  } catch { /* ignore */ }
  return map;
}

function saveAllTodos(map: Map<string, TodoItem[]>): void {
  try {
    const obj: Record<string, TodoItem[]> = {};
    for (const [key, val] of map.entries()) obj[key] = val;
    fs.writeFileSync(getTodoFile(), JSON.stringify(obj, null, 2), 'utf-8');
  } catch { /* ignore */ }
}

let cachedTodos: Map<string, TodoItem[]> | null = null;

function getStore(): Map<string, TodoItem[]> {
  if (!cachedTodos) cachedTodos = loadAllTodos();
  return cachedTodos;
}

function getSessionTodos(sessionId: string): TodoItem[] {
  const store = getStore();
  if (!store.has(sessionId)) store.set(sessionId, []);
  return store.get(sessionId)!;
}

function setSessionTodos(sessionId: string, todos: TodoItem[]): void {
  const store = getStore();
  store.set(sessionId, todos);
  saveAllTodos(store);
}

export function clearSessionTodos(sessionId: string): void {
  const store = getStore();
  store.delete(sessionId);
  saveAllTodos(store);
}

function validateTodo(item: any): TodoItem {
  const id = String(item?.id || '').trim() || '?';
  const content = String(item?.content || '').trim() || '(no description)';
  const status = VALID_STATUSES.has(String(item?.status || '')) ? item.status : 'pending';
  return { id, content, status };
}

let todoUpdateCallback: ((sessionId: string, todos: TodoItem[]) => void) | null = null;

export function onTodoUpdate(cb: (sessionId: string, todos: TodoItem[]) => void): void {
  todoUpdateCallback = cb;
}

function notifyTodoUpdate(sessionId: string): void {
  if (todoUpdateCallback) todoUpdateCallback(sessionId, getTodosForWebview(sessionId));
}

export function getTodosForWebview(sessionId: string): TodoItem[] {
  return getSessionTodos(sessionId).map(t => ({ ...t }));
}

export const todoTool = defineTool(
  'todo',
  'Manage todo/task list items',
  {
    type: 'object',
    properties: {
      session_id: { type: 'string', description: 'Session ID (default: default)' },
      merge: { type: 'boolean', description: 'Merge with existing todos (default: false = replace)' },
      todos: { type: 'array', description: 'Array of todo items: [{id, content, status}]' },
    },
    required: [],
  },
  async (args: Record<string, unknown>): Promise<string> => {
    const sessionId = (args.sessionId as string) || 'default';
    const merge = args.merge === true;
    const todosArg = args.todos as any[] | undefined;
    const current = getSessionTodos(sessionId);

    if (todosArg !== undefined) {
      if (!Array.isArray(todosArg)) return 'Error: todos must be an array';
      let newItems: TodoItem[];
      if (!merge) {
        newItems = todosArg.map(validateTodo);
      } else {
        const existing = new Map(current.map(t => [t.id, { ...t }]));
        for (const t of todosArg) {
          const item = validateTodo(t);
          if (existing.has(item.id)) {
            const prev = existing.get(item.id)!;
            if (item.content) prev.content = item.content;
            if (item.status) prev.status = item.status;
          } else {
            existing.set(item.id, item);
          }
        }
        newItems = Array.from(existing.values());
      }
      setSessionTodos(sessionId, newItems);
      notifyTodoUpdate(sessionId);
    }

    const todos = getSessionTodos(sessionId);
    const pending = todos.filter(t => t.status === 'pending').length;
    const inProgress = todos.filter(t => t.status === 'in_progress').length;
    const completed = todos.filter(t => t.status === 'completed').length;
    const cancelled = todos.filter(t => t.status === 'cancelled').length;

    const lines: string[] = [];
    lines.push('## Task List (' + todos.length + ' items)');
    lines.push('');
    for (const t of todos) {
      const marker = t.status === 'completed' ? '[x]' :
                     t.status === 'in_progress' ? '[>]' :
                     t.status === 'cancelled' ? '[-]' : '[ ]';
      lines.push('- ' + marker + ' ' + t.id + '. ' + t.content);
    }
    lines.push('');
    lines.push('**Summary:** ' + pending + ' pending \u00b7 ' + inProgress + ' in progress \u00b7 ' + completed + ' completed \u00b7 ' + cancelled + ' cancelled');
    return lines.join('\n');
  }
);
