"""
Pulse Agent — sessionSearch tool.

Search past conversation sessions using FTS5 full-text search.
Useful for recalling what was discussed, decisions made, or code reviewed
in previous sessions.

Design:
- Searches the SessionDB FTS index
- Returns matching sessions with excerpts
- Pure read-only (no state changes)
"""

from __future__ import annotations

import json
import logging
import sys
from pathlib import Path

logger = logging.getLogger(__name__)

name = "sessionSearch"
description = "Search past conversation sessions using full-text search. Use this when you need to recall what was discussed, what decisions were made, or what code was reviewed in a previous session. Searches across all stored conversations."
category = "session"
danger_level = "safe"
keywords = ("session", "history", "past", "recall", "search", "conversation")

parameters = {
    "type": "object",
    "properties": {
        "query": {
            "type": "string",
            "description": "Search terms to find in past sessions. Supports FTS5 syntax: AND is default, use OR for broader recall, double quotes for exact phrases.",
        },
        "limit": {
            "type": "integer",
            "description": "Maximum number of sessions to return (default: 5, max: 20).",
            "default": 5,
        },
    },
    "required": ["query"],
}


# ── Lazy import SessionDB ───────────────────────────────────────────────────

def _get_session_db() -> object | None:
    """Get the SessionDB instance, or None if not available."""
    try:
        # Add the agents directory to path
        agents_dir = Path(__file__).parent.parent
        if str(agents_dir) not in sys.path:
            sys.path.insert(0, str(agents_dir))
        from session_db import SessionDB
        return SessionDB()
    except Exception as e:
        logger.debug("SessionDB not available: %s", e)
        return None


# ── Tool entry point ────────────────────────────────────────────────────────

def run(query: str, limit: int = 5) -> str:
    """Search past conversation sessions."""
    limit = min(max(1, limit), 20)

    db = _get_session_db()
    if db is None:
        return json.dumps({
            "error": "Session database not available. Session persistence may not be configured.",
        })

    try:
        # Search for matching sessions
        sessions = db.search_sessions(query, limit=limit)
        if not sessions:
            return json.dumps({
                "results": [],
                "total": 0,
                "message": "No matching sessions found.",
            })

        output = []
        for s in sessions:
            output.append({
                "session_id": s.get("id", ""),
                "title": s.get("title", ""),
                "model": s.get("model", ""),
                "provider": s.get("provider", ""),
                "excerpt": s.get("excerpt", ""),
                "updated_at": s.get("updated_at", 0),
            })

        return json.dumps({
            "results": output,
            "total": len(output),
        }, indent=2)

    except Exception as e:
        return json.dumps({
            "error": f"Session search failed: {e}",
        })
