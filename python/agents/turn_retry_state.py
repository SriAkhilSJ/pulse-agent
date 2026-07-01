"""Per-attempt retry bookkeeping — one-shot recovery guards for a single API call attempt.

A fresh ``TurnRetryState`` is created for each outer turn iteration (one per API call).
Each guard fires its recovery branch at most once.
"""

from __future__ import annotations

from dataclasses import dataclass, fields


@dataclass
class TurnRetryState:
    """One-shot recovery guards for a single API-call attempt.

    Guards track which recovery branches have already been tried so each one
    fires at most once per attempt.  ``restart_with_*`` signals are set by the
    recovery branch and read by the outer loop after the attempt to decide
    whether to rebuild the request and retry.
    """

    # ── Auth / credential refresh ────────────────────────────────────
    auth_retry_attempted: bool = False

    # ── Format recovery ──────────────────────────────────────────────
    format_recovery_attempted: bool = False
    tools_stripped: bool = False

    # ── Context compression ──────────────────────────────────────────
    compress_attempted: bool = False

    # ── Fallback ─────────────────────────────────────────────────────
    fallback_attempted: bool = False

    # ── Restart signals (read by the outer loop) ─────────────────────
    restart_with_compressed_messages: bool = False
    restart_without_tools: bool = False
    restart_with_fallback: bool = False

    # ── General ──────────────────────────────────────────────────────
    has_retried_429: bool = False

    def __iter__(self):
        for f in fields(self):
            yield f.name, getattr(self, f.name)

    def reset_for_new_attempt(self) -> None:
        """Reset all guards for a fresh API call attempt.

        Called after a successful recovery that rebuilt the request —
        the new attempt starts with a clean slate.
        """
        self.auth_retry_attempted = False
        self.format_recovery_attempted = False
        self.compress_attempted = False
        self.fallback_attempted = False
        self.has_retried_429 = False
        # Don't reset tools_stripped — once stripped, stay stripped
        # Don't reset restart signals — they consumed by the loop
        self.restart_with_compressed_messages = False
        self.restart_without_tools = False
        self.restart_with_fallback = False
