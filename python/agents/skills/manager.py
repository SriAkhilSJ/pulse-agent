"""Pulse Agent — Skill Manager.

CRUD for skills with file-based persistence and search integration.
Skills are stored as SKILL.md files under ~/.pulse/skills/<name>/ for
easy manual editing and Hermes compatibility.
"""

from __future__ import annotations

import json
import logging
import os
import re
import time
from pathlib import Path
from typing import Optional

from .types import Skill

logger = logging.getLogger(__name__)

# ── Constants ───────────────────────────────────────────────────────────────

_SKILLS_DIR_NAME = "skills"
_SKILL_FILE = "SKILL.md"
_INDEX_FILE = "index.json"
_MAX_SKILLS = 500


# ═══════════════════════════════════════════════════════════════════════════════
# SkillManager
# ═══════════════════════════════════════════════════════════════════════════════

class SkillManager:
    """Manages skills: save, load, search, delete.

    Skills are stored as ``~/.pulse/skills/<name>/SKILL.md`` files.
    An index.json maintains search metadata.
    """

    def __init__(self, data_dir: str | None = None):
        if data_dir:
            self._base = Path(data_dir) / _SKILLS_DIR_NAME
        else:
            self._base = Path.home() / ".pulse" / _SKILLS_DIR_NAME
        self._base.mkdir(parents=True, exist_ok=True)
        self._index_path = self._base / _INDEX_FILE
        self._index: dict[str, dict] = {}
        self._load_index()

    # ── Index ───────────────────────────────────────────────────────────────

    def _load_index(self) -> None:
        """Load the skill index from disk."""
        if self._index_path.exists():
            try:
                data = json.loads(self._index_path.read_text(encoding="utf-8"))
                self._index = data if isinstance(data, dict) else {}
            except (json.JSONDecodeError, OSError):
                self._index = {}
        else:
            self._index = {}

    def _save_index(self) -> None:
        """Persist the skill index to disk."""
        try:
            self._index_path.write_text(
                json.dumps(self._index, indent=2, ensure_ascii=False),
                encoding="utf-8",
            )
        except OSError as e:
            logger.warning("Failed to save skill index: %s", e)

    def _update_index(self, skill: Skill) -> None:
        """Update index entry for a skill."""
        self._index[skill.name] = {
            "name": skill.name,
            "description": skill.description,
            "category": skill.category,
            "tags": skill.tags,
            "usage_count": skill.usage_count,
            "version": skill.version,
            "created_at": skill.created_at,
            "updated_at": skill.updated_at,
        }
        self._save_index()

    # ── CRUD ────────────────────────────────────────────────────────────────

    def save(self, skill: Skill) -> None:
        """Save a skill to disk.

        Creates ``~/.pulse/skills/<name>/SKILL.md``.
        """
        if len(self._index) >= _MAX_SKILLS and skill.name not in self._index:
            raise RuntimeError(
                f"Skill limit ({_MAX_SKILLS}) reached. Remove unused skills first."
            )

        skill_dir = self._base / skill.name
        skill_dir.mkdir(parents=True, exist_ok=True)
        skill_file = skill_dir / _SKILL_FILE

        skill.updated_at = time.time()
        skill_file.write_text(skill.content, encoding="utf-8")

        self._update_index(skill)
        logger.info("Saved skill '%s' (v%d, %d chars)", skill.name, skill.version, len(skill.content))

    def load(self, name: str) -> Skill | None:
        """Load a skill by name from disk.

        Returns None if the skill doesn't exist.
        """
        skill_file = self._base / name / _SKILL_FILE
        if not skill_file.exists():
            return None

        try:
            content = skill_file.read_text(encoding="utf-8")
        except OSError:
            return None

        # Parse YAML frontmatter for metadata
        meta = self._parse_frontmatter(content)
        index_entry = self._index.get(name, {})

        return Skill(
            name=name,
            description=meta.get("description", index_entry.get("description", "")),
            content=content,
            category=meta.get("category", index_entry.get("category", "")),
            tags=meta.get("tags", index_entry.get("tags", [])),
            created_at=index_entry.get("created_at", time.time()),
            updated_at=index_entry.get("updated_at", time.time()),
            usage_count=index_entry.get("usage_count", 0),
            version=index_entry.get("version", 1),
        )

    def delete(self, name: str) -> bool:
        """Delete a skill by name.

        Returns True if the skill was deleted, False if not found.
        """
        skill_dir = self._base / name
        if not skill_dir.exists():
            return False

        # Remove files
        for f in skill_dir.iterdir():
            try:
                f.unlink()
            except OSError:
                pass
        try:
            skill_dir.rmdir()
        except OSError:
            pass

        self._index.pop(name, None)
        self._save_index()
        logger.info("Deleted skill '%s'", name)
        return True

    def list_skills(
        self,
        category: str = "",
        limit: int = 50,
        offset: int = 0,
    ) -> list[dict]:
        """List skills with optional category filter.

        Returns list of skill metadata dicts.
        """
        entries = list(self._index.values())
        if category:
            entries = [e for e in entries if e.get("category", "").lower() == category.lower()]

        # Sort by updated_at descending
        entries.sort(key=lambda e: e.get("updated_at", 0), reverse=True)
        sliced = entries[offset:offset + limit]
        return sliced

    def count(self) -> int:
        """Total number of skills."""
        return len(self._index)

    # ── Search ──────────────────────────────────────────────────────────────

    def search(self, query: str, limit: int = 10) -> list[Skill]:
        """Search skills by name, description, category, and tags.

        Uses simple substring matching (no FTS). Returns scored results.
        """
        if not query or not query.strip():
            return [self.load(n) for n in list(self._index.keys())[:limit] if self.load(n) is not None]

        q = query.lower().strip()
        scored: list[tuple[Skill, int]] = []

        for name in self._index:
            entry = self._index[name]
            score = 0

            # Name match
            if q == name.lower():
                score += 50
            elif name.lower().startswith(q):
                score += 25
            elif q in name.lower():
                score += 15

            # Description match
            desc = entry.get("description", "").lower()
            if q == desc:
                score += 20
            elif q in desc:
                score += 10

            # Category match
            cat = entry.get("category", "").lower()
            if q in cat:
                score += 8

            # Tag match
            for tag in entry.get("tags", []):
                if q in tag.lower():
                    score += 5
                    break

            if score > 0:
                skill = self.load(name)
                if skill:
                    scored.append((skill, score))

        scored.sort(key=lambda x: (-x[1], -x[0].usage_count, x[0].name))
        return [s for s, _ in scored[:limit]]

    # ── Auto-inject ──────────────────────────────────────────────────────────

    def build_skills_block(self, context_hint: str = "") -> str:
        """Build a system prompt block with relevant skill references.

        Injects skills whose name/description match the current context.
        """
        if not self._index:
            return ""

        if context_hint:
            relevant = self.search(context_hint, limit=5)
        else:
            # No context: list most-used skills
            entries = sorted(
                self._index.values(),
                key=lambda e: e.get("usage_count", 0),
                reverse=True,
            )[:3]
            relevant = []
            for e in entries:
                s = self.load(e["name"])
                if s:
                    relevant.append(s)

        if not relevant:
            return ""

        lines = ["# Available Skills"]
        for s in relevant:
            lines.append(f"- **{s.name}**: {s.description}")
            if s.trigger_words:
                lines.append(f"  Trigger words: {', '.join(s.trigger_words)}")

        lines.append(
            "\nUse `skillTool` to save a new skill after completing a complex task, "
            "or `skillTool` with action='load' to read a skill's full content."
        )

        return "\n".join(lines)

    def record_usage(self, name: str) -> None:
        """Increment usage count for a skill."""
        if name in self._index:
            self._index[name]["usage_count"] = self._index[name].get("usage_count", 0) + 1
            self._save_index()

    # ── Rescan from disk ────────────────────────────────────────────────────

    def rescan_from_disk(self) -> int:
        """Scan the skills directory and rebuild the index from actual files.

        Handles skills created or modified outside the manager (e.g. by git).
        Returns the number of skills found.
        """
        found = 0
        for item in self._base.iterdir():
            if not item.is_dir():
                continue
            skill_file = item / _SKILL_FILE
            if skill_file.exists():
                name = item.name
                content = skill_file.read_text(encoding="utf-8")
                meta = self._parse_frontmatter(content)
                existing = self._index.get(name, {})

                self._index[name] = {
                    "name": name,
                    "description": meta.get("description", existing.get("description", "")),
                    "category": meta.get("category", existing.get("category", "")),
                    "tags": meta.get("tags", existing.get("tags", [])),
                    "usage_count": existing.get("usage_count", 0),
                    "version": existing.get("version", 1),
                    "created_at": existing.get("created_at", time.time()),
                    "updated_at": skill_file.stat().st_mtime,
                }
                found += 1

        self._save_index()
        return found

    # ── Helpers ─────────────────────────────────────────────────────────────

    @staticmethod
    def _parse_frontmatter(content: str) -> dict:
        """Parse YAML frontmatter from skill content.

        Returns a dict of metadata. Uses simple line parsing (no PyYAML dep).
        """
        meta = {}
        if not content.startswith("---"):
            return meta

        parts = content.split("---", 2)
        if len(parts) < 3:
            return meta

        frontmatter = parts[1]
        for line in frontmatter.split("\n"):
            line = line.strip()
            if ":" in line:
                key, _, val = line.partition(":")
                key = key.strip().lower()
                val = val.strip().strip('"').strip("'")

                if key in ("tags", "triggers"):
                    meta[key] = [t.strip() for t in val.split(",") if t.strip()]
                elif key == "description":
                    meta[key] = val
                elif key == "category":
                    meta[key] = val

        return meta
