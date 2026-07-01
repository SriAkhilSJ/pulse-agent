"""
Pulse Agent — memoryWrite tool.

Save durable facts to persistent memory that survive across sessions.
Memory is injected into every future turn, so keep entries compact.

Design:
- Stores key-value facts
- Facts are auto-injected into the system prompt on future sessions
- Supports categories/tags for organization
"""

from __future__ import annotations

import json
import logging
import time
from pathlib import Path

logger = logging.getLogger(__name__)

name = "memoryWrite"
description = "Save a durable fact to persistent memory. Memory is injected into every future conversation turn, so keep entries compact and focused on facts that will still matter later. Save user preferences, environment details, tool quirks, and stable conventions — NOT task progress or temporary state."
category = "memory"
danger_level = "safe"
keywords = ("memory", "remember", "save", "persist", "store", "fact")

parameters = {
    "type": "object",
    "properties": {
        "content": {
            "type": "string",
            "description": "The fact to remember. Write as a declarative fact, not an instruction. E.g. 'User prefers tabs over spaces' (not 'Always use tabs').",
        },
        "category": {
            "type": "string",
            "description": "Optional category for organizing memories (e.g. 'preference', 'convention', 'environment').",
            "default": "general",
        },
        "tags": {
            "type": "string",
            "description": "Optional comma-separated tags for searching.",
            "default": "",
        },
    },
    "required": ["content"],
}


# ── Data directory ──────────────────────────────────────────────────────────

def _memory_dir() -> Path:
    """Get or create the memory directory."""
    mem_dir = Path.home() / ".pulse" / "memory"
    mem_dir.mkdir(parents=True, exist_ok=True)
    return mem_dir


def _memory_file() -> Path:
    return _memory_dir() / "facts.json"


def _load_facts() -> list[dict]:
    """Load all saved facts."""
    mf = _memory_file()
    if not mf.exists():
        return []
    try:
        return json.loads(mf.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return []


def _save_facts(facts: list[dict]) -> None:
    """Save all facts."""
    _memory_file().write_text(
        json.dumps(facts, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


# ── Tool entry point ────────────────────────────────────────────────────────

def run(content: str, category: str = "general", tags: str = "") -> str:
    """Save a fact to persistent memory."""
    if not content or not content.strip():
        return json.dumps({"error": "Content cannot be empty"})

    facts = _load_facts()
    tag_list = [t.strip() for t in tags.split(",") if t.strip()] if tags else []

    # Check for duplicate (same content)
    for f in facts:
        if f.get("content") == content.strip():
            # Update timestamp
            f["updated_at"] = time.time()
            f["category"] = category
            if tag_list:
                existing_tags = set(f.get("tags", []))
                existing_tags.update(tag_list)
                f["tags"] = list(existing_tags)
            _save_facts(facts)
            return json.dumps({
                "success": True,
                "action": "updated",
                "content": content.strip()[:80] + ("..." if len(content) > 80 else ""),
                "category": category,
                "total_facts": len(facts),
            })

    # New fact
    fact = {
        "content": content.strip(),
        "category": category,
        "tags": tag_list,
        "created_at": time.time(),
        "updated_at": time.time(),
    }
    facts.append(fact)

    # Keep only last 200 facts
    if len(facts) > 200:
        facts = facts[-200:]

    _save_facts(facts)

    return json.dumps({
        "success": True,
        "action": "created",
        "content": content.strip()[:80] + ("..." if len(content) > 80 else ""),
        "category": category,
        "total_facts": len(facts),
    })
