// packages/backend/src/tools/image-gen-tool.ts
// Image Generation tool — generate images via ComfyUI API
// Uses raw HTTP to ComfyUI /prompt endpoint

import { defineTool } from '../tool-registry.js';
import * as fs from 'fs';
import * as path from 'path';

const COMFYUI_URL = process.env['COMFYUI_URL'] || 'http://localhost:8188';
const COMFYUI_OUTPUT_DIR = process.env['COMFYUI_OUTPUT_DIR'] || '/tmp/comfyui-output';

// Default simple text-to-image workflow (SD 1.5)
const DEFAULT_WORKFLOW = {
  '3': {
    class_type: 'KSampler',
    inputs: { seed: 0, steps: 20, cfg: 7.5, sampler_name: 'euler', scheduler: 'normal', denoise: 1, model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0] },
  },
  '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'v1-5-pruned-emaonly.safetensors' } },
  '5': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
  '6': { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['4', 1] } },
  '7': { class_type: 'CLIPTextEncode', inputs: { text: 'blurry, bad quality, distorted', clip: ['4', 1] } },
  '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
  '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'pulsecode', images: ['8', 0] } },
};

export const imageGenTool = defineTool('generate_image', 'Generate an image from a text prompt using ComfyUI (Stable Diffusion). Returns the file path of the generated image.', {
  type: 'object',
  properties: {
    prompt: { type: 'string', description: 'Text description of the image to generate' },
    negative_prompt: { type: 'string', description: 'What to avoid in the image (e.g., "blurry, bad quality")' },
    width: { type: 'number', description: 'Image width (default 512)' },
    height: { type: 'number', description: 'Image height (default 512)' },
    steps: { type: 'number', description: 'Sampling steps (default 20)' },
    cfg: { type: 'number', description: 'CFG scale (default 7.5)' },
  },
  required: ['prompt'],
}, async (args: Record<string, unknown>) => {
  const prompt = String(args.prompt);
  const negativePrompt = String(args.negative_prompt || 'blurry, bad quality, distorted');
  const width = Number(args.width || 512);
  const height = Number(args.height || 512);
  const steps = Number(args.steps || 20);
  const cfg = Number(args.cfg || 7.5);

  // Build workflow with user inputs
  const workflow = JSON.parse(JSON.stringify(DEFAULT_WORKFLOW));
  workflow['6'].inputs.text = prompt;
  workflow['7'].inputs.text = negativePrompt;
  workflow['5'].inputs.width = width;
  workflow['5'].inputs.height = height;
  workflow['3'].inputs.steps = steps;
  workflow['3'].inputs.cfg = cfg;
  workflow['3'].inputs.seed = Math.floor(Math.random() * 2147483647);

  try {
    // Submit prompt to ComfyUI
    const submitResponse = await fetch(`${COMFYUI_URL}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow }),
    });

    if (!submitResponse.ok) {
      return `ComfyUI error ${submitResponse.status}: ${submitResponse.statusText}`;
    }

    const submitData = await submitResponse.json() as any;
    const promptId = submitData.prompt_id;

    if (!promptId) {
      return 'ComfyUI did not return a prompt ID';
    }

    // Poll for completion (max 60 seconds)
    const maxWait = 60000;
    const pollInterval = 1000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
      await new Promise(r => setTimeout(r, pollInterval));

      // Check history for this prompt
      const historyResponse = await fetch(`${COMFYUI_URL}/history/${promptId}`);
      if (!historyResponse.ok) continue;

      const history = await historyResponse.json() as any;
      if (history && history[promptId]) {
        const outputs = history[promptId]?.outputs;
        if (outputs) {
          // Find the SaveImage output
          for (const nodeId of Object.keys(outputs)) {
            const nodeOutput = outputs[nodeId];
            if (nodeOutput?.images?.[0]) {
              const imageInfo = nodeOutput.images[0];
              const imageUrl = `${COMFYUI_URL}/view?filename=${imageInfo.filename}&subfolder=${imageInfo.subfolder || ''}&type=output`;
              return `Image generated: ${imageUrl}\nLocal path: ${path.join(COMFYUI_OUTPUT_DIR, imageInfo.subfolder || '', imageInfo.filename)}`;
            }
          }
        }
        return 'Image generation completed but no output found';
      }
    }

    return `Image generation timed out after ${maxWait / 1000}s. Prompt ID: ${promptId}`;
  } catch (err) {
    return `Image generation failed: ${(err as Error).message}. Make sure ComfyUI is running at ${COMFYUI_URL}.`;
  }
});
