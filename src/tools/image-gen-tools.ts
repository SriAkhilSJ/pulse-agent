// src/tools/image-gen-tools.ts
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { defineTool } from '../tool-registry';
import { config } from '../config';

function getGenDir(): string {
  const wf = vscode.workspace.workspaceFolders;
  const base = wf ? wf[0].uri.fsPath : process.cwd();
  const dir = path.join(base, '.pulse', 'generated');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export const generateImage = defineTool(
  'generate_image',
  'Generate an image from a text prompt via ComfyUI or OpenRouter',
  {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'Image description/prompt' },
      size: { type: 'string', description: 'Image size (optional)' },
    },
    required: ['prompt'],
  },
  async (args: Record<string, unknown>): Promise<string> => {
    const prompt = args.prompt as string;
    if (!prompt) throw new Error('generate_image requires "prompt"');
    const apiKey = (process.env['IMAGEGEN_API_KEY'] || '').trim();
    const baseURL = (process.env['IMAGEGEN_URL'] || '').replace(/\/+$/, '');
    const model = (process.env['IMAGEGEN_MODEL'] || 'v1-5-pruned-emaonly.safetensors').trim();
    if (!baseURL) throw new Error('Set IMAGEGEN_URL in .env');
    const isComfy = !baseURL.includes('openrouter') && !baseURL.includes('ollama');
    if (isComfy) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), config.imageGenTimeoutMs);
        const workflow = {
          "3": { "class_type": "KSampler", "inputs": { "seed": Math.floor(Math.random() * 2147483647), "steps": 20, "cfg": 7.5, "sampler_name": "euler", "scheduler": "normal", "denoise": 1, "model": ["4", 0], "positive": ["6", 0], "negative": ["7", 0], "latent_image": ["5", 0] } },
          "4": { "class_type": "CheckpointLoaderSimple", "inputs": { "ckpt_name": model } },
          "5": { "class_type": "EmptyLatentImage", "inputs": { "width": 512, "height": 512, "batch_size": 1 } },
          "6": { "class_type": "CLIPTextEncode", "inputs": { "text": prompt, "clip": ["4", 1] } },
          "7": { "class_type": "CLIPTextEncode", "inputs": { "text": "blurry, low quality, distorted, ugly", "clip": ["4", 1] } },
          "8": { "class_type": "VAEDecode", "inputs": { "samples": ["3", 0], "vae": ["4", 2] } },
          "9": { "class_type": "SaveImage", "inputs": { "filename_prefix": "pulse_gen", "images": ["8", 0] } }
        };
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (apiKey && apiKey !== 'none') headers['Authorization'] = 'Bearer ' + apiKey;
        headers['ngrok-skip-browser-warning'] = 'true';
        const qr = await fetch(baseURL + '/prompt', { method: 'POST', headers, body: JSON.stringify({ prompt: workflow }), signal: controller.signal });
        if (qr.status !== 200) { const err = await qr.text(); throw new Error('ComfyUI queue failed: ' + err.substring(0, 200)); }
        const qd = await qr.json() as any;
        const promptId = qd.prompt_id;
        for (let i = 0; i < config.imageGenMaxPolls; i++) {
          await new Promise(r => setTimeout(r, config.imageGenPollIntervalMs));
          const sr = await fetch(baseURL + '/history/' + promptId, { headers, signal: controller.signal });
          if (sr.ok) {
            const sd = await sr.json() as any;
            if (sd[promptId]?.outputs) {
              for (const [, output] of Object.entries(sd[promptId].outputs)) {
                if ((output as any).images) {
                  for (const img of (output as any).images) {
                    const ir = await fetch(baseURL + '/view?filename=' + encodeURIComponent(img.filename) + '&subfolder=' + encodeURIComponent(img.subfolder || '') + '&type=' + (img.type || 'output'), { headers, signal: controller.signal });
                    const buf = Buffer.from(await ir.arrayBuffer());
                    const name = 'gen-' + Date.now() + '.png';
                    const dir = getGenDir();
                    const relPath = '.pulse/generated/' + name;
                    fs.writeFileSync(path.join(dir, name), buf);
                    clearTimeout(timeout);
                    return JSON.stringify({ imagePath: relPath, imageBase64: buf.toString('base64'), size: buf.length });
                  }
                }
              }
            }
          }
        }
        clearTimeout(timeout);
        throw new Error('ComfyUI generation timed out');
      } catch (err) {
        console.log('[ImageGen] ComfyUI error:', (err as Error).message);
      }
    }
    const orKey = process.env['OPENROUTER_API_KEY'];
    const orURL = process.env['OPENROUTER_URL'] || 'https://openrouter.ai/api/v1';
    if (orKey) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), config.imageGenTimeoutMs);
        const res = await fetch(orURL + '/images/generations', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + orKey },
          body: JSON.stringify({ model: process.env['IMAGEGEN_MODEL'] || 'stabilityai/stable-diffusion-3.5-large', prompt, n: 1, size: '512x512' }),
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (res.ok) {
          const data = await res.json() as any;
          const imageUrl = data.data?.[0]?.url;
          if (imageUrl) {
            const imgRes = await fetch(imageUrl);
            const buf = Buffer.from(await imgRes.arrayBuffer());
            const name = 'gen-' + Date.now() + '.png';
            const dir = getGenDir();
            fs.writeFileSync(path.join(dir, name), buf);
            return 'Generated: .pulse/generated/' + name + '\nURL: ' + imageUrl;
          }
        }
      } catch (err) {
        console.log('[ImageGen] OpenRouter error:', (err as Error).message);
      }
    }
    throw new Error('Image generation failed. Check IMAGEGEN_URL in .env');
  }
);
