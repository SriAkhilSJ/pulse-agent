"""
Pulse Agent — memoryRead tool.

Recall saved facts from persistent memory. Searches by keyword, category, or tag.
Returns matching memories for injecting into the current context.

Design:
- Searches across all saved facts
- Returns matching facts grouped by category
- Pure read-only (no state changes)
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

name = "memoryRead"
description = "Recall saved facts from persistent memory. Search by keyword, category, or tag to find previously saved information about user preferences, project conventions, environment setup, and other durable facts."
category = "memory"
danger_level = "safe"
keywords = ("memory", "remember", "recall", "fact", "find")

parameters = {
    "type": "object",
    "properties": {
        "query": {
            "type": "string",
            "description": "Keyword to search for in memory contents, categories, and tags.",
        },
        "category": {
            "type": "string",
            "description": "Optional category filter (e.g. 'preference', 'convention', 'environment').",
            "default": "",
        },
        "limit": {
            "type": "integer",
            "description": "Maximum number of results to return (default: 20).",
            "default": 20,
        },
    },
}


# ── Data directory ──────────────────────────────────────────────────────────

def _memory_dir() -> Path:
    return Path.home() / ".pulse" / "memory"


def _memory_file() -> Path:
    return _memory_dir() / "facts.json"


def _load_facts() -> list[dict]:
    mf = _memory_file()
    if not mf.exists():
        return []
    try:
        return json.loads(mf.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return []


# ── Tool entry point ────────────────────────────────────────────────────────

def run(query: str = "", category: str = "", limit: int = 20) -> str:
    """Recall saved facts from persistent memory."""
    limit = min(max(1, limit), 50)

    facts = _load_facts()
    if not facts:
        return json.dumps({
            "results": [],
            "total": 0,
            "message": "No saved memories found.",
        })

    q = query.lower().strip() if query else ""
    cat_filter = category.lower().strip() if category else ""

    results = []
    for f in facts:
        # Category filter
        if cat_filter and f.get("category", "").lower() != cat_filter:
            continue

        # Query filter
        if q:
            content = f.get("content", "").lower()
            tags = " ".join(f.get("tags", [])).lower()
            fcat = f.get("category", "").lower()
            if q not in content and q not in tags and q not in fcat:
                continue

        results.append({
            "content": f.get("content", ""),
            "category": f.get("category", "general"),
            "tags": f.get("tags", []),
            "created_at": f.get("created_at", 0),
            "updated_at": f.get("updated_at", 0),
        })

        if len(results) >= limit:
            break

    # Sort by updated_at descending
    results.sort(key=lambda x: x.get("updated_at", 0), reverse=True)

    return json.dumps({
        "results": results,
        "total": len(results),
        "total_facts": len(facts),
    }, indent=2)
