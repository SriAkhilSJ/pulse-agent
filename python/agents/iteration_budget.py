"""Iteration budget — thread-safe consume/refund counter for agent turns."""

from __future__ import annotations

import threading


class IterationBudget:
    """Thread-safe iteration counter for an agent.

    Each ReAct loop iteration consumes one unit.  ``execute_code``-style
    programmatic turns can be refunded via :meth:`refund`.
    """

    def __init__(self, max_total: int):
        self.max_total = max_total
        self._used = 0
        self._lock = threading.Lock()

    @property
    def used(self) -> int:
        with self._lock:
            return self._used

    @property
    def remaining(self) -> int:
        with self._lock:
            return max(0, self.max_total - self._used)

    def consume(self) -> bool:
        """Try to consume one iteration. Returns True if allowed, False if budget exhausted."""
        with self._lock:
            if self._used >= self.max_total:
                return False
            self._used += 1
            return True

    def refund(self) -> None:
        """Give back one iteration (e.g. for execute_code turns)."""
        with self._lock:
            if self._used > 0:
                self._used -= 1

    def reset(self) -> None:
        """Reset the counter to zero."""
        with self._lock:
            self._used = 0
