"""
Pulse Agent — webSearch tool.

Search the web for documentation, examples, and technical answers.
Uses the configured web search backend (DDGS, or direct URL extraction).

Design:
- Uses duckduckgo_search library (lazy-imported) or httpx for web extraction
- Returns structured results with titles, URLs, and descriptions
- Safe for IDE use: no JavaScript execution, plain HTTP
"""

from __future__ import annotations

import json
import logging

logger = logging.getLogger(__name__)

name = "webSearch"
description = "Search the web for documentation, examples, tutorials, and technical information. Returns up to 5 results with titles, URLs, and descriptions."
category = "network"
danger_level = "safe"
requires_network = True  # noqa: F811
keywords = ("search", "web", "internet", "documentation", "google", "docs")

parameters = {
    "type": "object",
    "properties": {
        "query": {
            "type": "string",
            "description": "The search query. Supports site:domain, filetype:pdf, -term, and quoted \"exact phrase\" operators.",
        },
        "limit": {
            "type": "integer",
            "description": "Maximum number of search results to return (default: 5, max: 20).",
            "default": 5,
        },
    },
    "required": ["query"],
}


def run(query: str, limit: int = 5) -> str:
    """Execute a web search and return structured results."""
    limit = min(max(1, limit), 20)

    try:
        # Lazy-import duckduckgo_search
        from duckduckgo_search import DDGS

        with DDGS() as ddgs:
            results = list(ddgs.text(query, max_results=limit))

        if not results:
            return json.dumps({"results": [], "message": "No results found."})

        output = []
        for r in results:
            output.append({
                "title": r.get("title", ""),
                "url": r.get("href", ""),
                "description": r.get("body", ""),
            })

        return json.dumps({"results": output, "total": len(output)}, indent=2)

    except ImportError:
        # Fallback: try httpx-based web extraction
        return _fallback_search(query, limit)
    except Exception as e:
        # Try fallback
        try:
            return _fallback_search(query, limit)
        except Exception as e2:
            return json.dumps({
                "error": f"Web search failed: {e}",
                "fallback_error": str(e2),
            })


def _fallback_search(query: str, limit: int) -> str:
    """Fallback search using httpx + a public search API."""
    import httpx
    import urllib.parse

    encoded = urllib.parse.quote(query)
    url = f"https://html.duckduckgo.com/html/?q={encoded}"

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) PulseAgent/1.0",
    }

    resp = httpx.get(url, headers=headers, follow_redirects=True, timeout=15)
    resp.raise_for_status()

    # Extract results from HTML (simple regex parsing)
    import re
    results = []
    # Match result blocks
    blocks = re.findall(
        r'<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)</a>',
        resp.text,
    )
    snippets = re.findall(
        r'<a[^>]*class="result__snippet"[^>]*>([^<]*)</a>',
        resp.text,
    )

    for i, (url, title) in enumerate(blocks[:limit]):
        snippet = snippets[i] if i < len(snippets) else ""
        results.append({
            "title": title.strip(),
            "url": url,
            "description": snippet.strip(),
        })

    return json.dumps({"results": results, "total": len(results)}, indent=2)
