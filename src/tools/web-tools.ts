// src/tools/web-tools.ts
// Web search and fetch tools.

import { defineTool } from '../tool-registry';
import { config } from '../config';

export const webSearchTool = defineTool(
  'web_search',
  'Search the web for information using DuckDuckGo',
  {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
      max_results: { type: 'number', description: 'Max results (default: 5)' },
    },
    required: ['query'],
  },
  async (args: Record<string, unknown>): Promise<string> => {
    const query = args.query as string;
    const maxResults = (args.max_results as number) || config.webSearchMaxResults;
    if (!query) throw new Error('web_search requires "query"');
    const MAX_RETRIES = config.webSearchMaxRetries;
    const RETRY_DELAY_MS = 1500;
    let lastError = '';
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, RETRY_DELAY_MS * attempt));
      try {
        const url = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query);
        const res = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/html,application/xhtml+xml',
            'Accept-Language': 'en-US,en;q=0.9',
          },
          signal: AbortSignal.timeout(config.webSearchTimeoutMs),
        });
        if (!res.ok) { lastError = 'HTTP ' + res.status; if (res.status >= 500) continue; throw new Error('Search returned ' + res.status); }
        const html = await res.text();
        const results: string[] = [];
        const titleRe = /<a rel="nofollow" class="result__a" href="([^"]*)"[^>]*>([^<]*)<\/a>/g;
        const snippetRe = /<a class="result__snippet"[^>]*>([^<]*)<\/a>/g;
        let m;
        const titles: string[] = [];
        const snippets: string[] = [];
        while ((m = titleRe.exec(html)) !== null) titles.push(m[2]);
        while ((m = snippetRe.exec(html)) !== null) snippets.push(m[1]);
        for (let i = 0; i < Math.min(titles.length, maxResults); i++) {
          results.push('[' + (i + 1) + '] ' + titles[i] + '\n' + (snippets[i] || ''));
        }
        if (results.length > 0) return 'Web search results for "' + query + '" (' + results.length + ' results):\n\n' + results.join('\n\n');
        lastError = 'No results parsed';
        break;
      } catch (err: unknown) {
        lastError = (err as Error).message;
        if (attempt >= MAX_RETRIES) break;
      }
    }
    return 'Web search unavailable: ' + lastError + '. Try using web_fetch to retrieve specific URLs.';
  }
);

export const webFetchTool = defineTool(
  'web_fetch',
  'Fetch and extract readable content from a URL',
  {
    type: 'object',
    properties: { url: { type: 'string', description: 'URL to fetch' } },
    required: ['url'],
  },
  async (args: Record<string, unknown>): Promise<string> => {
    const url = args.url as string;
    if (!url) throw new Error('web_fetch requires "url"');
    try {
      const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(config.webFetchTimeoutMs) });
      const text = await response.text();
      const stripped = text
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '$2 ($1)')
        .replace(/<\/?(p|div|h[1-6]|li|tr|blockquote|pre|br|ul|ol|table|td|th|section|article|header|footer|nav|main|aside|figure|figcaption|details|summary)[^>]*>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        .substring(0, 8000);
      return 'Content from ' + url + ':\n\n' + stripped;
    } catch (err: unknown) {
      return 'Fetch failed: ' + (err as Error).message;
    }
  }
);
