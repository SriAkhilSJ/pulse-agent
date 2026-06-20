// src/tools/vision-tools.ts
// Image analysis using a vision-capable model.

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { defineTool } from '../tool-registry';
import { config } from '../config';

function resolveImagePath(imagePath: string): string {
  const wf = vscode.workspace.workspaceFolders;
  const base = wf ? wf[0].uri.fsPath : process.cwd();
  return path.resolve(base, imagePath);
}

function getVisionConfig(): { apiKey: string; baseURL: string; model: string } {
  if (process.env['VISION_URL']) {
    return {
      apiKey: process.env['VISION_API_KEY'] || '',
      baseURL: process.env['VISION_URL'],
      model: process.env['VISION_MODEL'] || 'llava:7b',
    };
  }
  const activeProvider = (process.env['PROVIDER'] || 'openrouter').toLowerCase();
  const prefix = activeProvider.toUpperCase();
  return {
    apiKey: process.env[prefix + '_API_KEY'] || process.env['API_KEY'] || '',
    baseURL: process.env[prefix + '_URL'] || process.env['OPENROUTER_URL'] || 'https://openrouter.ai/api/v1',
    model: process.env[prefix + '_MODEL'] || process.env['OPENROUTER_MODEL'] || 'openrouter/owl-alpha',
  };
}

export const seeImage = defineTool(
  'see_image',
  'Analyze an image using a vision model',
  {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the image file' },
      question: { type: 'string', description: 'Question about the image (default: describe the image)' },
    },
    required: ['path'],
  },
  async (args: Record<string, unknown>): Promise<string> => {
    const imagePath = args.path as string;
    const question = (args.question as string) || 'Describe this image in detail. List all visible objects, text, and UI elements.';
    if (!imagePath) throw new Error('see_image requires "path"');
    const fullPath = resolveImagePath(imagePath);
    if (!fs.existsSync(fullPath)) throw new Error('Image not found: ' + imagePath);
    const base64 = fs.readFileSync(fullPath, 'base64');
    const ext = path.extname(fullPath).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : ext === '.gif' ? 'image/gif' : 'image/png';
    const { apiKey, baseURL, model } = getVisionConfig();
    const urlsToTry = [baseURL.replace(/\/+$/, '') + '/v1/chat/completions'];
    if (baseURL.includes('ollama') || baseURL.includes('ngrok')) {
      urlsToTry.push(baseURL.replace(/\/+$/, '') + '/api/generate');
    }
    let lastError = '';
    for (const url of urlsToTry) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), config.visionTimeoutMs);
        let res: Response;
        if (url.includes('/api/generate')) {
          res = await fetch(url, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, prompt: question, images: [base64], stream: false }),
            signal: controller.signal,
          });
        } else {
          const headers: Record<string, string> = { 'Content-Type': 'application/json' };
          if (apiKey) headers['Authorization'] = 'Bearer ' + apiKey;
          res = await fetch(url, {
            method: 'POST', headers,
            body: JSON.stringify({
              model, messages: [{ role: 'user', content: [{ type: 'text', text: question }, { type: 'image_url', image_url: { url: 'data:' + mime + ';base64,' + base64 } }] }],
              max_tokens: 2000,
            }),
            signal: controller.signal,
          });
        }
        clearTimeout(timeout);
        if (!res.ok) { lastError = await res.text(); continue; }
        const data = await res.json() as any;
        if (data.choices?.[0]?.message?.content) return data.choices[0].message.content;
        if (data.response) return data.response;
        lastError = 'No content in response';
      } catch (err) {
        lastError = (err as Error).message;
      }
    }
    throw new Error('Vision failed. Last error: ' + lastError);
  }
);

export const assertImageContains = defineTool(
  'assert_image_contains',
  'Assert that an image contains certain content',
  {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the image file' },
      expected: { type: 'string', description: 'Expected content description' },
    },
    required: ['path', 'expected'],
  },
  async (args: Record<string, unknown>): Promise<string> => {
    const imagePath = args.path as string;
    const expected = args.expected as string;
    if (!imagePath || !expected) throw new Error('assert_image_contains requires "path" + "expected"');
    const description = await seeImage({ path: imagePath, question: 'Does this image contain: ' + expected + '? Answer YES or NO with a brief explanation.' });
    if (description.toUpperCase().startsWith('YES')) return 'Image contains: ' + expected;
    return 'Image does NOT contain: ' + expected + '. ' + description;
  }
);
