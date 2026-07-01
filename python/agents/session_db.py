"""
Pulse Agent — Session DB (FTS5 SQLite session persistence).

Provides persistent storage for conversation sessions with full-text search.
Thread-safe via WAL mode and connection-per-thread pattern.

Design:
- One database file per workspace/profile (stored in ~/.pulse/sessions/)
- FTS5 index on session_id + role + content for cross-session search
- WAL mode for concurrent read/write without locking
- Sessions auto-pruned after 30 days
- Minimum viable schema — no ORM, raw SQLite via stdlib sqlite3
"""

from __future__ import annotations

import json
import logging
import os
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

# ── Defaults ────────────────────────────────────────────────────────────────

_SESSION_TTL_DAYS = 30
_SESSIONS_DIR_NAME = "sessions"
_DB_FILENAME = "pulse_sessions.db"

# ── Schema ──────────────────────────────────────────────────────────────────

_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS sessions (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL DEFAULT '',
    model       TEXT NOT NULL DEFAULT '',
    provider    TEXT NOT NULL DEFAULT '',
    created_at  REAL NOT NULL,
    updated_at  REAL NOT NULL,
    metadata    TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    role        TEXT NOT NULL CHECK(role IN ('system','user','assistant','tool')),
    content     TEXT NOT NULL DEFAULT '',
    tool_calls  TEXT,
    tool_call_id TEXT,
    created_at  REAL NOT NULL,
    msg_index   INTEGER NOT NULL DEFAULT 0
);

CREATE VIRTUAL TABLE IF NOT EXISTS session_fts USING fts5(
    session_id UNINDEXED,
    role UNINDEXED,
    content,
    tokenize='porter unicode61'
);

CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, msg_index);
CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at);

-- Triggers to keep FTS in sync
CREATE TRIGGER IF NOT EXISTS trg_messages_fts_insert AFTER INSERT ON messages
BEGIN
    INSERT INTO session_fts(session_id, role, content)
    VALUES (NEW.session_id, NEW.role, NEW.content);
END;

CREATE TRIGGER IF NOT EXISTS trg_messages_fts_delete AFTER DELETE ON messages
BEGIN
    DELETE FROM session_fts WHERE rowid = OLD.id;
END;
"""


# ═══════════════════════════════════════════════════════════════════════════════
# SQLite connection helpers
# ═══════════════════════════════════════════════════════════════════════════════


def _get_db_path(data_dir: str | None = None) -> str:
    """Get the database file path, creating parent directories as needed."""
    if data_dir:
        db_dir = Path(data_dir) / _SESSIONS_DIR_NAME
    else:
        home = Path.home() / ".pulse"
        db_dir = home / _SESSIONS_DIR_NAME
    db_dir.mkdir(parents=True, exist_ok=True)
    return str(db_dir / _DB_FILENAME)


# ── Thread-local connection ─────────────────────────────────────────────────

_local = threading.local()


def _get_connection(db_path: str) -> sqlite3.Connection:
    """Get or create a thread-local SQLite connection with WAL mode."""
    attr = f"_conn_{db_path}"
    conn = getattr(_local, attr, None)
    if conn is None:
        conn = sqlite3.connect(db_path, timeout=10)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("PRAGMA busy_timeout=5000")
        conn.execute("PRAGMA foreign_keys=ON")
        setattr(_local, attr, conn)
    return conn


# ═══════════════════════════════════════════════════════════════════════════════
# SessionDB
# ═══════════════════════════════════════════════════════════════════════════════


class SessionDB:
    """FTS5-backed session store for Pulse Agent conversation persistence.

    Usage::

        db = SessionDB()
        session_id = db.create_session(title="Debug auth bug")
        db.save_messages(session_id, messages)
        results = db.search("auth token error")
    """

    def __init__(self, data_dir: str | None = None):
        self.db_path = _get_db_path(data_dir)
        self._init_schema()

    def _init_schema(self) -> None:
        """Create tables and indexes if they don't exist."""
        conn = _get_connection(self.db_path)
        conn.executescript(_SCHEMA_SQL)
        conn.commit()

    # ── Session CRUD ────────────────────────────────────────────────────────

    def create_session(
        self,
        session_id: str,
        title: str = "",
        model: str = "",
        provider: str = "",
        metadata: dict | None = None,
    ) -> dict:
        """Create a new session.

        Returns the session record as a dict.
        """
        now = time.time()
        meta_json = json.dumps(metadata or {})
        conn = _get_connection(self.db_path)
        conn.execute(
            """INSERT OR IGNORE INTO sessions (id, title, model, provider, created_at, updated_at, metadata)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (session_id, title, model, provider, now, now, meta_json),
        )
        conn.commit()
        return self.get_session(session_id)

    def get_session(self, session_id: str) -> dict | None:
        """Get a session by ID, or None if not found."""
        conn = _get_connection(self.db_path)
        row = conn.execute(
            "SELECT * FROM sessions WHERE id = ?", (session_id,)
        ).fetchone()
        if row is None:
            return None
        return dict(row)

    def update_session(
        self,
        session_id: str,
        title: str | None = None,
        metadata: dict | None = None,
    ) -> None:
        """Update session title and/or metadata."""
        now = time.time()
        conn = _get_connection(self.db_path)
        if title is not None:
            conn.execute(
                "UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?",
                (title, now, session_id),
            )
        if metadata is not None:
            conn.execute(
                "UPDATE sessions SET metadata = ?, updated_at = ? WHERE id = ?",
                (json.dumps(metadata), now, session_id),
            )
        conn.commit()

    def delete_session(self, session_id: str) -> None:
        """Delete a session and all its messages (cascade)."""
        conn = _get_connection(self.db_path)
        conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
        conn.commit()

    def list_sessions(
        self, limit: int = 50, offset: int = 0
    ) -> list[dict]:
        """List recent sessions ordered by updated_at descending."""
        conn = _get_connection(self.db_path)
        rows = conn.execute(
            """SELECT id, title, model, provider, created_at, updated_at, metadata
               FROM sessions ORDER BY updated_at DESC LIMIT ? OFFSET ?""",
            (limit, offset),
        ).fetchall()
        return [dict(r) for r in rows]

    def count_sessions(self) -> int:
        """Total number of sessions in the database."""
        conn = _get_connection(self.db_path)
        row = conn.execute("SELECT COUNT(*) AS cnt FROM sessions").fetchone()
        return row["cnt"] if row else 0

    # ── Message persistence ─────────────────────────────────────────────────

    def save_messages(
        self, session_id: str, messages: list[dict], clear_first: bool = False
    ) -> int:
        """Save conversation messages to a session.

        Args:
            session_id: Target session.
            messages: List of OpenAI-format message dicts.
            clear_first: If True, delete existing messages first.

        Returns:
            Number of messages saved.
        """
        conn = _get_connection(self.db_path)
        now = time.time()

        if clear_first:
            conn.execute("DELETE FROM messages WHERE session_id = ?", (session_id,))

        count = 0
        for idx, msg in enumerate(messages):
            role = msg.get("role", "user")
            content = msg.get("content", "")

            # Handle content that is a list (multimodal parts)
            if isinstance(content, list):
                text_parts = []
                for part in content:
                    if isinstance(part, dict) and part.get("type") == "text":
                        text_parts.append(part.get("text", ""))
                content = " ".join(text_parts)
            elif not isinstance(content, str):
                content = json.dumps(content, default=str)

            tool_calls = msg.get("tool_calls")
            tool_calls_json = json.dumps(tool_calls) if tool_calls else None

            tool_call_id = msg.get("tool_call_id")

            conn.execute(
                """INSERT INTO messages (session_id, role, content, tool_calls, tool_call_id, created_at, msg_index)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (session_id, role, content, tool_calls_json, tool_call_id, now, idx),
            )
            count += 1

        # Update session timestamp
        conn.execute(
            "UPDATE sessions SET updated_at = ? WHERE id = ?",
            (now, session_id),
        )
        conn.commit()
        return count

    def load_messages(
        self, session_id: str, limit: int = 1000, offset: int = 0
    ) -> list[dict]:
        """Load messages for a session, ordered by msg_index.

        Returns OpenAI-format message dicts.
        """
        conn = _get_connection(self.db_path)
        rows = conn.execute(
            """SELECT role, content, tool_calls, tool_call_id, msg_index
               FROM messages WHERE session_id = ?
               ORDER BY msg_index ASC LIMIT ? OFFSET ?""",
            (session_id, limit, offset),
        ).fetchall()

        messages = []
        for row in rows:
            msg = {"role": row["role"], "content": row["content"]}
            if row["tool_calls"]:
                try:
                    msg["tool_calls"] = json.loads(row["tool_calls"])
                except (json.JSONDecodeError, TypeError):
                    pass
            if row["tool_call_id"]:
                msg["tool_call_id"] = row["tool_call_id"]
            messages.append(msg)

        return messages

    def message_count(self, session_id: str) -> int:
        """Count messages in a session."""
        conn = _get_connection(self.db_path)
        row = conn.execute(
            "SELECT COUNT(*) AS cnt FROM messages WHERE session_id = ?",
            (session_id,),
        ).fetchone()
        return row["cnt"] if row else 0

    # ── Full-Text Search ────────────────────────────────────────────────────

    def search(
        self,
        query: str,
        limit: int = 10,
        offset: int = 0,
    ) -> list[dict]:
        """Search across all sessions using FTS5.

        Returns a list of dicts with keys:
            session_id, role, content (snippet), created_at, rank
        """
        conn = _get_connection(self.db_path)
        rows = conn.execute(
            """SELECT
                   fts.session_id,
                   fts.role,
                   snippet(session_fts, 2, '<b>', '</b>', '...', 40) AS content_snippet,
                   m.created_at,
                   rank
               FROM session_fts fts
               JOIN messages m ON m.id = fts.rowid
               WHERE session_fts MATCH ?
               ORDER BY rank
               LIMIT ? OFFSET ?""",
            (query, limit, offset),
        ).fetchall()

        results = []
        for row in rows:
            results.append({
                "session_id": row["session_id"],
                "role": row["role"],
                "content_snippet": row["content_snippet"],
                "created_at": row["created_at"],
                "rank": row["rank"],
            })
        return results

    def search_sessions(
        self,
        query: str,
        limit: int = 10,
    ) -> list[dict]:
        """Search and return whole session summaries (not individual messages).

        Returns a list of session dicts with a match excerpt.
        """
        conn = _get_connection(self.db_path)
        rows = conn.execute(
            """SELECT DISTINCT
                   s.id, s.title, s.model, s.provider,
                   s.created_at, s.updated_at,
                   (SELECT snippet(session_fts, 2, '<b>', '</b>', '...', 40)
                    FROM session_fts fts
                    JOIN messages m ON m.id = fts.rowid
                    WHERE fts.session_id = s.id AND session_fts MATCH ?
                    LIMIT 1) AS excerpt
               FROM sessions s
               WHERE s.id IN (
                   SELECT DISTINCT session_id FROM session_fts WHERE session_fts MATCH ?
               )
               ORDER BY s.updated_at DESC
               LIMIT ?""",
            (query, query, limit),
        ).fetchall()

        results = []
        for row in rows:
            results.append({
                "id": row["id"],
                "title": row["title"],
                "model": row["model"],
                "provider": row["provider"],
                "created_at": row["created_at"],
                "updated_at": row["updated_at"],
                "excerpt": row["excerpt"] or "",
            })
        return results

    # ── Maintenance ─────────────────────────────────────────────────────────

    def prune_old_sessions(self, ttl_days: int = _SESSION_TTL_DAYS) -> int:
        """Delete sessions older than *ttl_days*.

        Returns the number of deleted sessions.
        """
        cutoff = time.time() - (ttl_days * 86400)
        conn = _get_connection(self.db_path)
        cursor = conn.execute(
            "DELETE FROM sessions WHERE updated_at < ?", (cutoff,)
        )
        deleted = cursor.rowcount
        if deleted:
            logger.info("Pruned %d sessions older than %d days", deleted, ttl_days)
        conn.commit()
        return deleted

    def rebuild_fts(self) -> None:
        """Rebuild the FTS index (useful after bulk inserts or corruption)."""
        conn = _get_connection(self.db_path)
        conn.execute("INSERT INTO session_fts(session_fts) VALUES('rebuild')")
        conn.commit()

    def vacuum(self) -> None:
        """Recover disk space."""
        conn = _get_connection(self.db_path)
        conn.execute("VACUUM")
        conn.commit()

    def close(self) -> None:
        """Close all connections for this instance."""
        conn = getattr(_local, f"_conn_{self.db_path}", None)
        if conn:
            conn.close()
            try:
                delattr(_local, f"_conn_{self.db_path}")
            except AttributeError:
                pass
