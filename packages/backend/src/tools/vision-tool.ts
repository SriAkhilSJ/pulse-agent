// packages/backend/src/tools/vision-tool.ts
// Vision tool — analyze images using Ollama llava:7b

import { defineTool } from '../tool-registry.js';
import * as fs from 'fs';

const OLLAMA_URL = process.env['OLLAMA_URL'] || 'http://localhost:11434';
const VISION_MODEL = process.env['VISION_MODEL'] || 'llava:7b';

export const visionTool = defineTool('vision', 'Analyze an image (file path or URL) and describe its contents. Useful for understanding UI, reading text from images, or identifying objects.', {
  type: 'object',
  properties: {
    image: { type: 'string', description: 'Image source: file path (e.g., /tmp/screenshot.png) or URL (https://...)' },
    prompt: { type: 'string', description: 'What to look for in the image. Be specific.' },
  },
  required: ['image'],
}, async (args: Record<string, unknown>) => {
  const imageSource = String(args.image);
  const prompt = String(args.prompt || 'Describe this image in detail.');

  let base64: string;

  try {
    if (imageSource.startsWith('http://') || imageSource.startsWith('https://')) {
      const response = await fetch(imageSource);
      const buffer = Buffer.from(await response.arrayBuffer());
      base64 = buffer.toString('base64');
    } else if (fs.existsSync(imageSource)) {
      const buffer = fs.readFileSync(imageSource);
      base64 = buffer.toString('base64');
    } else {
      return `Error: Image not found: ${imageSource}. Provide a file path or URL.`;
    }
  } catch (err) {
    return `Error loading image: ${(err as Error).message}`;
  }

  try {
    const response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: VISION_MODEL,
        prompt,
        images: [base64],
        stream: false,
      }),
    });

    if (!response.ok) {
      return `Vision model error ${response.status}: ${response.statusText}`;
    }

    const data = await response.json() as any;
    return data.response || 'No description returned';
  } catch (err) {
    return `Vision analysis failed: ${(err as Error).message}. Make sure Ollama is running with ${VISION_MODEL}.`;
  }
});
