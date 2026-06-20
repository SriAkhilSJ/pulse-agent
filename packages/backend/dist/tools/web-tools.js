"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.webFetchTool = exports.webSearchTool = void 0;
// packages/backend/src/tools/web-tools.ts
const tool_registry_js_1 = require("../tool-registry.js");
const config_js_1 = require("../config.js");
exports.webSearchTool = (0, tool_registry_js_1.defineTool)('web_search', 'Search the web', {
    type: 'object',
    properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', description: 'Max results (default 5)' },
    },
    required: ['query'],
}, async (args) => {
    const query = String(args.query);
    const limit = args.limit ? Number(args.limit) : config_js_1.config.webSearchMaxResults;
    try {
        const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`;
        const response = await fetch(url, { signal: AbortSignal.timeout(config_js_1.config.webSearchTimeoutMs) });
        const data = await response.json();
        const results = [];
        if (data.AbstractText)
            results.push(`Summary: ${data.AbstractText}`);
        if (data.Answer)
            results.push(`Answer: ${data.Answer}`);
        for (const topic of (data.RelatedTopics || []).slice(0, limit)) {
            if (topic.Text)
                results.push(`- ${topic.Text}`);
        }
        return results.join('\n') || 'No results found';
    }
    catch (err) {
        return `Search failed: ${err.message}`;
    }
});
exports.webFetchTool = (0, tool_registry_js_1.defineTool)('web_fetch', 'Fetch content from a URL', {
    type: 'object',
    properties: { url: { type: 'string', description: 'URL to fetch' } },
    required: ['url'],
}, async (args) => {
    const url = String(args.url);
    try {
        const response = await fetch(url, { signal: AbortSignal.timeout(config_js_1.config.webFetchTimeoutMs) });
        const text = await response.text();
        return text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 4000);
    }
    catch (err) {
        return `Fetch failed: ${err.message}`;
    }
});
//# sourceMappingURL=web-tools.js.map