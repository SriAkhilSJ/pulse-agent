// packages/backend/src/tools/change-tools.ts
import * as fs from 'fs';
import { defineTool } from '../tool-registry.js';

interface ChangeEntry { filePath: string; originalContent: string; newContent: string; timestamp: number; }
const changeLog: ChangeEntry[] = [];

export const logChangeTool = defineTool('log_change', 'Log a file change for potential revert', {
  type: 'object',
  properties: { path: { type: 'string' }, original: { type: 'string' }, new_content: { type: 'string' } },
  required: ['path', 'original', 'new_content'],
}, async (args: Record<string, unknown>) => {
  changeLog.push({ filePath: String(args.path), originalContent: String(args.original), newContent: String(args.new_content), timestamp: Date.now() });
  return `Logged change: ${args.path}`;
});

export const getChangeLogTool = defineTool('get_change_log', 'Get the change log', {
  type: 'object', properties: {}, required: [],
}, async () => {
  return changeLog.map(c => `${c.filePath} @ ${new Date(c.timestamp).toISOString()}`).join('\n') || 'No changes logged';
});

export const revertChangesTool = defineTool('revert_changes', 'Revert a file to its original content', {
  type: 'object', properties: { path: { type: 'string' } }, required: ['path'],
}, async (args: Record<string, unknown>) => {
  const filePath = String(args.path);
  const entry = [...changeLog].reverse().find(c => c.filePath === filePath);
  if (!entry) return `No change log entry for ${filePath}`;
  fs.writeFileSync(filePath, entry.originalContent, 'utf-8');
  return `Reverted ${filePath}`;
});

export const clearChangeLog = defineTool('clear_change_log', 'Clear the change log', {
  type: 'object', properties: {}, required: [],
}, async () => { changeLog.length = 0; return 'Change log cleared'; });
