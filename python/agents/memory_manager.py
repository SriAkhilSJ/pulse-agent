"""MemoryManager — orchestrates memory lifecycle for the agent.

Provides:
  - build_snapshot() — frozen memory for system prompt injection
  - prefetch_all() — recall before a turn (currently returns snapshot)
  - sync_turn() — post-turn memory updates (placeholder for auto-extraction)
  - memory_tool() — LLM-facing tool for manual CRUD operations

Integration point in agent_loop.py: one MemoryManager instance per session.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Optional

from memory_store import MemoryStore

logger = logging.getLogger(__name__)


class MemoryManager:
    """Memory lifecycle manager.

    Wraps a MemoryStore and provides the integration surface for the agent loop.
    """

    def __init__(self, store: Optional[MemoryStore] = None):
        self._store = store or MemoryStore()
        self._turn_count = 0

    # ── Properties ──────────────────────────────────────────────────────

    @property
    def store(self) -> MemoryStore:
        return self._store

    @property
    def is_available(self) -> bool:
        """Memory is always available when the store is initialized."""
        return self._store is not None

    # ── System prompt integration ───────────────────────────────────────

    def build_snapshot(self) -> str:
        """Build the frozen memory snapshot for the system prompt.

        Returns a formatted string with memory and user profile entries,
        or empty string if no entries exist.
        """
        if not self.is_available:
            return ""
        return self._store.build_snapshot()

    # ── Pre-turn prefetch ───────────────────────────────────────────────

    def prefetch_all(self, query: str = "") -> str:
        """Recall relevant memory before a turn.

        Currently returns the full snapshot.  Future: semantic search over
        memory entries to return only query-relevant entries.

        Args:
            query: The user's message, used for relevance scoring.

        Returns:
            Formatted memory context string, or empty string.
        """
        return self.build_snapshot()

    # ── Post-turn sync ──────────────────────────────────────────────────

    def sync_turn(
        self,
        user_message: str,
        assistant_response: str,
        interrupted: bool = False,
    ) -> None:
        """Post-turn sync hook.

        Called after each completed turn.  Future: auto-extract facts,
        preferences, and patterns from the exchange and persist them.

        Args:
            user_message: The user's original message.
            assistant_response: The agent's final response.
            interrupted: Whether the turn was interrupted.
        """
        self._turn_count += 1

        if interrupted or not assistant_response:
            return

        # Future: auto-extraction of facts would go here
        # e.g. detect "I prefer X" patterns and auto-save to user profile

    # ── LLM-Facing Tool ─────────────────────────────────────────────────

    def memory_tool(
        self,
        action: str = "",
        target: str = "memory",
        content: str = "",
        old_text: str = "",
    ) -> str:
        """Handle a memory tool call from the agent.

        Args:
            action: One of "add", "replace", "remove", "list".
            target: "memory" or "user".
            content: Content for add/replace.
            old_text: Substring match for replace/remove.

        Returns:
            JSON string with result.
        """
        if not self.is_available:
            return json.dumps({"success": False, "error": "Memory is not available."})

        if action == "add":
            if not content:
                return json.dumps({"success": False, "error": "content is required for add."})
            result = self._store.add(target, content)
            return json.dumps(result, ensure_ascii=False)

        elif action == "replace":
            if not old_text or not content:
                return json.dumps({"success": False, "error": "old_text and content are required for replace."})
            result = self._store.replace(target, old_text, content)
            return json.dumps(result, ensure_ascii=False)

        elif action == "remove":
            if not old_text:
                return json.dumps({"success": False, "error": "old_text is required for remove."})
            result = self._store.remove(target, old_text)
            return json.dumps(result, ensure_ascii=False)

        elif action == "list":
            entries = self._store.list_entries(target)
            current = self._store._char_count(target)
            limit = self._store._char_limit(target)
            return json.dumps({
                "success": True,
                "entries": entries,
                "usage": f"{current:,}/{limit:,}",
            }, ensure_ascii=False, default=str)

        else:
            return json.dumps({
                "success": False,
                "error": f"Unknown action '{action}'. Use add, replace, remove, or list.",
            })

    # ── Cleanup ─────────────────────────────────────────────────────────

    def shutdown(self) -> None:
        """Clean shutdown.  Future: flush pending writes, close connections."""
        logger.info("Memory manager shut down (%d turns)", self._turn_count)
