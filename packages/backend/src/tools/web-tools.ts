// packages/backend/src/tools/web-tools.ts
import { defineTool } from '../tool-registry.js';
import { config } from '../config.js';

export const webSearchTool = defineTool('web_search', 'Search the web', {
  type: 'object',
  properties: {
    query: { type: 'string', description: 'Search query' },
    limit: { type: 'number', description: 'Max results (default 5)' },
  },
  required: ['query'],
}, async (args) => {
  const query = String(args.query);
  const limit = args.limit ? Number(args.limit) : config.webSearchMaxResults;
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`;
    const response = await fetch(url, { signal: AbortSignal.timeout(config.webSearchTimeoutMs) });
    const data = await response.json() as any;
    const results: string[] = [];
    if (data.AbstractText) results.push(`Summary: ${data.AbstractText}`);
    if (data.Answer) results.push(`Answer: ${data.Answer}`);
    for (const topic of (data.RelatedTopics || []).slice(0, limit)) {
      if (topic.Text) results.push(`- ${topic.Text}`);
    }
    return results.join('\n') || 'No results found';
  } catch (err) {
    return `Search failed: ${(err as Error).message}`;
  }
});

export const webFetchTool = defineTool('web_fetch', 'Fetch content from a URL', {
  type: 'object',
  properties: { url: { type: 'string', description: 'URL to fetch' } },
  required: ['url'],
}, async (args) => {
  const url = String(args.url);
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(config.webFetchTimeoutMs) });
    const text = await response.text();
    return text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 4000);
  } catch (err) {
    return `Fetch failed: ${(err as Error).message}`;
  }
});
