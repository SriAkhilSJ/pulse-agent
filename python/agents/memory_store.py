"""MemoryStore — SQLite-backed persistent memory with add/replace/remove.

Two stores:
  - ``memory``: agent's personal notes (environment facts, project conventions, tool quirks)
  - ``user``: what the agent knows about the user (preferences, style, workflow)

Memory is injected into the system prompt as a frozen snapshot at session start.
Mid-session writes update the DB immediately but do NOT change the system prompt
(frozen snapshot pattern — preserves prefix cache for the entire session).
"""

from __future__ import annotations

import json
import logging
import os
import sqlite3
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

# Default char limits per store
_CHAR_LIMITS = {
    "memory": 2_200,
    "user": 1_400,
}

_DB_FILENAME = "pulse_memory.db"

# Entry delimiter for display
ENTRY_DELIMITER = "\n§\n"


@dataclass
class MemoryEntry:
    """A single memory entry."""
    id: int
    target: str  # "memory" or "user"
    content: str
    created_at: str
    updated_at: str


class MemoryStore:
    """Bounded persistent memory backed by SQLite.

    Thread-safe via reentrant lock.  One instance per agent session.
    """

    def __init__(self, db_path: Optional[str] = None):
        self._lock = threading.Lock()
        self._db_path = db_path or str(Path.home() / ".pulse" / _DB_FILENAME)
        self._init_db()

    # ── DB lifecycle ────────────────────────────────────────────────────

    def _init_db(self) -> None:
        """Create tables if they don't exist."""
        os.makedirs(os.path.dirname(self._db_path), exist_ok=True)
        with self._connect() as conn:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS memory_entries (
                    id        INTEGER PRIMARY KEY AUTOINCREMENT,
                    target    TEXT NOT NULL CHECK(target IN ('memory','user')),
                    content   TEXT NOT NULL,
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
                );
                CREATE INDEX IF NOT EXISTS idx_memory_target ON memory_entries(target);
            """)

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self._db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        return conn

    # ── Char limit helpers ──────────────────────────────────────────────

    def _char_limit(self, target: str) -> int:
        return _CHAR_LIMITS.get(target, 2_000)

    def _char_count(self, target: str) -> int:
        """Return total characters used across all entries for a target."""
        with self._connect() as conn:
            row = conn.execute(
                "SELECT COALESCE(SUM(LENGTH(content)), 0) FROM memory_entries WHERE target=?",
                (target,),
            ).fetchone()
            return row[0]

    def _entries_for(self, target: str) -> list[dict[str, Any]]:
        """Return all entries for a target, ordered by creation time."""
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT id, content, created_at, updated_at FROM memory_entries "
                "WHERE target=? ORDER BY id ASC",
                (target,),
            ).fetchall()
            return [dict(r) for r in rows]

    # ── CRUD operations ─────────────────────────────────────────────────

    def add(self, target: str, content: str) -> dict[str, Any]:
        """Add a new memory entry. Returns result dict."""
        if target not in ("memory", "user"):
            return {"success": False, "error": f"Invalid target '{target}'. Use 'memory' or 'user'."}

        current = self._char_count(target)
        limit = self._char_limit(target)
        new_chars = len(content)

        if current + new_chars > limit:
            return {
                "success": False,
                "error": f"Char limit ({limit:,}) would be exceeded: {current:,} + {new_chars:,} > {limit:,}. "
                         f"Remove or shorten existing entries first.",
                "current_entries": self._entries_for(target),
                "usage": f"{current:,}/{limit:,}",
            }

        with self._lock, self._connect() as conn:
            conn.execute(
                "INSERT INTO memory_entries (target, content) VALUES (?, ?)",
                (target, content),
            )
            entry_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
            conn.commit()
            logger.info("Memory added [%s] id=%d (%d chars)", target, entry_id, new_chars)
            return {
                "success": True,
                "id": entry_id,
                "usage": f"{current + new_chars:,}/{limit:,}",
            }

    def replace(self, target: str, old_text: str, content: str) -> dict[str, Any]:
        """Replace a memory entry identified by substring match on old_text."""
        if target not in ("memory", "user"):
            return {"success": False, "error": f"Invalid target '{target}'."}
        if not old_text:
            return self._missing_old_text(target)

        with self._lock, self._connect() as conn:
            rows = conn.execute(
                "SELECT id, content FROM memory_entries WHERE target=? AND content LIKE ? "
                "ORDER BY id ASC",
                (target, f"%{old_text}%"),
            ).fetchall()

            if len(rows) == 0:
                return {"success": False, "error": f"No entry containing {old_text!r} found.", "current_entries": self._entries_for(target)}
            if len(rows) > 1:
                return {
                    "success": False,
                    "error": f"Multiple entries contain {old_text!r}. Be more specific.",
                    "matches": [{"id": r["id"], "content": r["content"][:100]} for r in rows],
                }

            entry_id = rows[0]["id"]
            new_chars = len(content)
            current_total = self._char_count(target)
            old_chars = len(rows[0]["content"])
            limit = self._char_limit(target)

            if current_total - old_chars + new_chars > limit:
                return {"success": False, "error": f"Char limit ({limit:,}) would be exceeded."}

            conn.execute(
                "UPDATE memory_entries SET content=?, updated_at=datetime('now') WHERE id=?",
                (content, entry_id),
            )
            conn.commit()
            logger.info("Memory replaced [%s] id=%d", target, entry_id)
            return {"success": True, "id": entry_id}

    def remove(self, target: str, old_text: str) -> dict[str, Any]:
        """Remove a memory entry identified by substring match."""
        if target not in ("memory", "user"):
            return {"success": False, "error": f"Invalid target '{target}'."}
        if not old_text:
            return self._missing_old_text(target)

        with self._lock, self._connect() as conn:
            rows = conn.execute(
                "SELECT id, content FROM memory_entries WHERE target=? AND content LIKE ? "
                "ORDER BY id ASC",
                (target, f"%{old_text}%"),
            ).fetchall()

            if len(rows) == 0:
                return {"success": False, "error": f"No entry containing {old_text!r} found.", "current_entries": self._entries_for(target)}
            if len(rows) > 1:
                return {
                    "success": False,
                    "error": f"Multiple entries contain {old_text!r}. Be more specific.",
                    "matches": [{"id": r["id"], "content": r["content"][:100]} for r in rows],
                }

            entry_id = rows[0]["id"]
            conn.execute("DELETE FROM memory_entries WHERE id=?", (entry_id,))
            conn.commit()
            logger.info("Memory removed [%s] id=%d", target, entry_id)
            return {"success": True, "id": entry_id}

    def list_entries(self, target: str) -> list[dict[str, Any]]:
        """List all entries for a target."""
        if target not in ("memory", "user"):
            return []
        return self._entries_for(target)

    def _missing_old_text(self, target: str) -> dict[str, Any]:
        """Return error when old_text is required but missing."""
        entries = self._entries_for(target)
        current = self._char_count(target)
        limit = self._char_limit(target)
        return {
            "success": False,
            "error": (
                f"replace/remove needs old_text — a short unique substring of the entry "
                f"to target. None was provided. Reissue with old_text set to part of "
                f"one of the current entries below."
            ),
            "current_entries": entries,
            "usage": f"{current:,}/{limit:,}",
        }

    # ── Snapshot for system prompt injection ────────────────────────────

    def build_snapshot(self) -> str:
        """Build the frozen snapshot string for system prompt injection.

        Format:
            MEMORY (2,200 chars):
            entry 1
            §
            entry 2

            USER (1,400 chars):
            entry 1
        """
        parts = []
        for target in ("memory", "user"):
            entries = self._entries_for(target)
            if not entries:
                continue
            current = sum(len(e["content"]) for e in entries)
            limit = self._char_limit(target)
            label = target.upper()
            entry_texts = [e["content"] for e in entries]
            block = ENTRY_DELIMITER.join(entry_texts)
            parts.append(f"{label} [{current:,}/{limit:,} chars]:\n{block}")

        if not parts:
            return ""
        return "\n\n".join(parts)

    # ── Utility ─────────────────────────────────────────────────────────

    def clear(self, target: Optional[str] = None) -> None:
        """Clear all entries (for testing)."""
        with self._lock, self._connect() as conn:
            if target:
                conn.execute("DELETE FROM memory_entries WHERE target=?", (target,))
            else:
                conn.execute("DELETE FROM memory_entries")
            conn.commit()

    @property
    def db_path(self) -> str:
        return self._db_path
