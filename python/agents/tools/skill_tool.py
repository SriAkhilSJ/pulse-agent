"""
Pulse Agent — skillTool.

Allows the agent to save, load, list, and search skills.
Skills are reusable procedures that the agent learns from experience.

Design:
- save: Create/update a skill from content
- load: Get full content of a skill by name
- list: List all skills with optional category filter
- search: Find skills by keyword
- delete: Remove a skill
"""

from __future__ import annotations

import json
import logging
import sys
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

name = "skillTool"
description = "Manage reusable skills. Actions: save (create/update a skill with YAML frontmatter + markdown content), load (get full content of a skill by name), list (list all skills), search (find skills by keyword), delete (remove a skill the user no longer wants)."
category = "knowledge"
danger_level = "low"
keywords = ("skill", "learn", "remember", "procedure", "workflow", "template", "reuse")

parameters = {
    "type": "object",
    "properties": {
        "action": {
            "type": "string",
            "enum": ["save", "load", "list", "search", "delete"],
            "description": "What to do with the skill.",
        },
        "name": {
            "type": "string",
            "description": "Skill name (required for save/load/delete, optional for search). Use lowercase with hyphens.",
        },
        "content": {
            "type": "string",
            "description": "Full SKILL.md content with YAML frontmatter. Required for save action. Format: ---\\ndescription: ...\\ncategory: ...\\ntags: ...\\n---\\n\\n# Skill content in markdown...",
        },
        "category": {
            "type": "string",
            "description": "Category filter for list action (optional).",
            "default": "",
        },
        "query": {
            "type": "string",
            "description": "Search query for search action.",
            "default": "",
        },
    },
    "required": ["action"],
}


# ── Lazy import SkillManager ───────────────────────────────────────────────

_SKILL_MGR: Any = None


def _get_manager() -> Any:
    global _SKILL_MGR
    if _SKILL_MGR is None:
        try:
            from skills.manager import SkillManager
            _SKILL_MGR = SkillManager()
        except Exception as e:
            logger.error("Failed to init SkillManager: %s", e)
            return None
    return _SKILL_MGR


# ── Tool Entry Point ────────────────────────────────────────────────────────


def run(
    action: str,
    name: str = "",
    content: str = "",
    category: str = "",
    query: str = "",
) -> str:
    """Execute a skill management action."""
    mgr = _get_manager()
    if mgr is None:
        return json.dumps({"error": "Skill system not available"})

    try:
        if action == "save":
            return _save(mgr, name, content)
        elif action == "load":
            return _load(mgr, name)
        elif action == "list":
            return _list(mgr, category)
        elif action == "search":
            return _search(mgr, query)
        elif action == "delete":
            return _delete(mgr, name)
        else:
            return json.dumps({"error": f"Unknown action: {action}"})
    except Exception as e:
        logger.error("skillTool error: %s", e, exc_info=True)
        return json.dumps({"error": f"Skill operation failed: {e}"})


# ── Action handlers ────────────────────────────────────────────────────────


def _save(mgr: Any, name: str, content: str) -> str:
    """Save a skill."""
    if not name:
        return json.dumps({"error": "name is required for save"})
    if not content:
        return json.dumps({"error": "content is required for save"})

    from skills.types import Skill

    # Parse metadata from frontmatter
    desc = ""
    cat = ""
    tags = []
    if content.startswith("---"):
        parts = content.split("---", 2)
        if len(parts) >= 3:
            meta = mgr._parse_frontmatter(content)
            desc = meta.get("description", desc)
            cat = meta.get("category", cat)
            tags = meta.get("tags", tags)

    # Check if updating existing skill
    existing = mgr.load(name)
    version = (existing.version + 1) if existing else 1
    usage_count = (existing.usage_count or 0) if existing else 0

    skill = Skill(
        name=name,
        description=desc,
        content=content,
        category=cat,
        tags=tags,
        version=version,
        usage_count=usage_count,
    )

    mgr.save(skill)
    return json.dumps({
        "success": True,
        "action": "saved",
        "name": name,
        "version": version,
        "description": desc or "(no description)",
    })


def _load(mgr: Any, name: str) -> str:
    """Load and return full skill content."""
    if not name:
        return json.dumps({"error": "name is required for load"})

    skill = mgr.load(name)
    if skill is None:
        return json.dumps({"error": f"Skill '{name}' not found"})

    mgr.record_usage(name)
    return json.dumps({
        "success": True,
        "name": skill.name,
        "description": skill.description,
        "content": skill.content,
        "category": skill.category,
        "tags": skill.tags,
        "version": skill.version,
        "usage_count": skill.usage_count,
    })


def _list(mgr: Any, category: str = "") -> str:
    """List all skills."""
    skills = mgr.list_skills(category=category)
    return json.dumps({
        "success": True,
        "skills": skills,
        "total": len(skills),
        "category": category or "all",
    })


def _search(mgr: Any, query: str) -> str:
    """Search skills."""
    if not query:
        return json.dumps({"error": "query is required for search"})

    results = mgr.search(query)
    return json.dumps({
        "success": True,
        "query": query,
        "results": [s.to_dict() for s in results],
        "total": len(results),
    })


def _delete(mgr: Any, name: str) -> str:
    """Delete a skill."""
    if not name:
        return json.dumps({"error": "name is required for delete"})

    deleted = mgr.delete(name)
    if deleted:
        return json.dumps({"success": True, "action": "deleted", "name": name})
    else:
        return json.dumps({"error": f"Skill '{name}' not found"})
