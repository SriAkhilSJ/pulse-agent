// packages/backend/src/tools/file/file-tools.ts
import * as fs from 'fs';
import * as path from 'path';
import { defineTool } from '../../tool-registry.js';

const fileCache = new Map<string, { content: string; timestamp: number }>();

export const readFileTool = defineTool('read_file', 'Read a file from disk', {
  type: 'object',
  properties: { path: { type: 'string', description: 'File path to read' } },
  required: ['path'],
}, async (args) => {
  const filePath = String(args.path);
  const cached = fileCache.get(filePath);
  if (cached && Date.now() - cached.timestamp < 30000) return cached.content;
  const content = fs.readFileSync(filePath, 'utf-8');
  fileCache.set(filePath, { content, timestamp: Date.now() });
  return content;
});

export const writeFileTool = defineTool('write_file', 'Write content to a file', {
  type: 'object',
  properties: {
    path: { type: 'string', description: 'File path to write' },
    content: { type: 'string', description: 'Content to write' },
  },
  required: ['path', 'content'],
}, async (args) => {
  const filePath = String(args.path);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, String(args.content), 'utf-8');
  fileCache.set(filePath, { content: String(args.content), timestamp: Date.now() });
  return `Written ${filePath}`;
});

export const listFilesTool = defineTool('list_files', 'List files in a directory', {
  type: 'object',
  properties: { path: { type: 'string', description: 'Directory path' } },
  required: ['path'],
}, async (args) => {
  const dir = String(args.path);
  if (!fs.existsSync(dir)) return `Directory not found: ${dir}`;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.map(e => (e.isDirectory() ? '[DIR] ' : '[FILE] ') + e.name).join('\n');
});

export const editFileTool = defineTool('edit_file', 'Edit a file by replacing text', {
  type: 'object',
  properties: {
    path: { type: 'string', description: 'File path' },
    old_text: { type: 'string', description: 'Text to find' },
    new_text: { type: 'string', description: 'Replacement text' },
  },
  required: ['path', 'old_text', 'new_text'],
}, async (args) => {
  const filePath = String(args.path);
  const content = fs.readFileSync(filePath, 'utf-8');
  const oldText = String(args.old_text);
  if (!content.includes(oldText)) return `Text not found in ${filePath}`;
  fs.writeFileSync(filePath, content.replace(oldText, String(args.new_text)), 'utf-8');
  return `Edited ${filePath}`;
});

export const searchCodeTool = defineTool('search_code', 'Search for text in files', {
  type: 'object',
  properties: {
    query: { type: 'string', description: 'Search query' },
    path: { type: 'string', description: 'Directory to search in' },
  },
  required: ['query'],
}, async (args) => {
  const query = String(args.query).toLowerCase();
  const searchDir = args.path ? String(args.path) : process.cwd();
  const results: string[] = [];
  const walk = (dir: string) => {
    if (results.length >= 20) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (results.length >= 20) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!['node_modules', '.git', 'dist', 'out'].includes(entry.name)) walk(full);
      } else if (entry.name.match(/\.(ts|tsx|js|jsx|py|java|c|cpp|go|rs|rb|php|md|json|yaml|yml|html|css)$/)) {
        try {
          const content = fs.readFileSync(full, 'utf-8');
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes(query)) {
              results.push(`${full}:${i + 1}: ${lines[i].trim()}`);
              break;
            }
          }
        } catch { /* skip */ }
      }
    }
  };
  walk(searchDir);
  return results.join('\n') || 'No matches found';
});

export const clearReadCache = defineTool('clear_read_cache', 'Clear the file read cache', {
  type: 'object', properties: {}, required: [],
}, async () => {
  fileCache.clear();
  return 'Cache cleared';
});

// Batch read multiple files in parallel — reduces latency for multi-file operations
export const batchReadTool = defineTool('batch_read_files', 'Read multiple files in parallel (faster than sequential reads)', {
  type: 'object',
  properties: {
    paths: { type: 'array', items: { type: 'string' }, description: 'Array of file paths to read' },
  },
  required: ['paths'],
}, async (args) => {
  const paths = args.paths as string[];
  const results = await Promise.all(
    paths.map(async (filePath: string) => {
      const cached = fileCache.get(filePath);
      if (cached && Date.now() - cached.timestamp < 30000) {
        return { path: filePath, content: cached.content, cached: true };
      }
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        fileCache.set(filePath, { content, timestamp: Date.now() });
        return { path: filePath, content, cached: false };
      } catch (err) {
        return { path: filePath, content: `Error: ${(err as Error).message}`, error: true };
      }
    })
  );
  return JSON.stringify(results, null, 2);
});
