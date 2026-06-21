// packages/backend/src/tools/vision-tool.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { visionTool } from './vision-tool.js';

const mockFetch = vi.fn();
global.fetch = mockFetch;

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

import * as fs from 'fs';

describe('visionTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should analyze a local image file', async () => {
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readFileSync as any).mockReturnValue(Buffer.from('fake-image-data'));

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ response: 'A screenshot of a code editor.' }),
    });

    const result = await (visionTool as any)({ image: '/tmp/screenshot.png', prompt: 'What is in this image?' });
    expect(result).toContain('screenshot');
  });

  it('should fetch and analyze an image from URL', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ response: 'A beautiful landscape.' }) });

    const result = await (visionTool as any)({ image: 'https://example.com/photo.jpg', prompt: 'Describe' });
    expect(result).toContain('landscape');
  });

  it('should return error for non-existent file', async () => {
    (fs.existsSync as any).mockReturnValue(false);
    const result = await (visionTool as any)({ image: '/nonexistent.png', prompt: 'What?' });
    expect(result).toContain('Error');
  });

  it('should handle Ollama errors', async () => {
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readFileSync as any).mockReturnValue(Buffer.from('fake'));
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Error' });

    const result = await (visionTool as any)({ image: '/tmp/test.png', prompt: 'Describe' });
    expect(result).toContain('error');
  });

  it('should handle network errors', async () => {
    (fs.existsSync as any).mockReturnValue(true);
    (fs.readFileSync as any).mockReturnValue(Buffer.from('fake'));
    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

    const result = await (visionTool as any)({ image: '/tmp/test.png', prompt: 'Describe' });
    expect(result).toContain('failed');
  });
});
