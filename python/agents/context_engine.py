"""Context engine — manages conversation context to stay within the model's token limit.

Provides:
- ``ContextEngine`` abstract base class
- ``ContextCompressor`` — built-in summarization-based compaction
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from typing import Any, Optional

logger = logging.getLogger(__name__)


class ContextEngine(ABC):
    """Base class for context engines that manage conversation token budgets."""

    name: str = "base"

    # Token tracking (updated after each API response)
    last_prompt_tokens: int = 0
    last_completion_tokens: int = 0
    last_total_tokens: int = 0

    # Compression parameters
    threshold_percent: float = 0.75
    threshold_tokens: int = 0
    context_length: int = 0
    compression_count: int = 0

    # Protection: keep first N / last N messages verbatim during compression.
    protect_first_n: int = 3
    protect_last_n: int = 6

    @abstractmethod
    def update_from_response(self, usage: dict[str, Any]) -> None:
        """Update tracked token usage from a normalized API response usage dict."""

    @abstractmethod
    def should_compress(self, prompt_tokens: int) -> bool:
        """Return True when compression should fire based on token usage."""

    @abstractmethod
    def compress(
        self,
        messages: list[dict[str, Any]],
        system_prompt: str,
    ) -> tuple[list[dict[str, Any]], str]:
        """Compress messages to fit within budget.

        Returns:
            (compressed_messages, updated_system_prompt)
        """


class ContextCompressor(ContextEngine):
    """Built-in context compressor that summarises old messages when nearing the limit.

    Strategy: keep the system prompt, protect_first_n head messages, and
    protect_last_n tail messages verbatim.  Summarise everything in between
    into a single synthetic user/assistant exchange.
    """

    name: str = "compressor"

    def __init__(
        self,
        context_length: int = 200_000,
        threshold_percent: float = 0.75,
        protect_first_n: int = 3,
        protect_last_n: int = 6,
    ):
        self.context_length = context_length
        self.threshold_percent = threshold_percent
        self.threshold_tokens = int(context_length * threshold_percent)
        self.protect_first_n = protect_first_n
        self.protect_last_n = protect_last_n
        self.compression_count = 0

    def update_from_response(self, usage: dict[str, Any]) -> None:
        self.last_prompt_tokens = usage.get("prompt_tokens", 0)
        self.last_completion_tokens = usage.get("completion_tokens", 0)
        self.last_total_tokens = usage.get("total_tokens", 0)

    def should_compress(self, prompt_tokens: int) -> bool:
        return prompt_tokens >= self.threshold_tokens

    def compress(
        self,
        messages: list[dict[str, Any]],
        system_prompt: str,
    ) -> tuple[list[dict[str, Any]], str]:
        """Compress messages by summarising the middle section.

        Preserves:
        1. System prompt (always)
        2. First ``protect_first_n`` non-system messages (head)
        3. Last ``protect_last_n`` messages (tail — recent context)
        4. Summarise everything between head and tail

        Returns:
            (compressed_messages, system_prompt)
        """
        if len(messages) <= self.protect_first_n + self.protect_last_n + 1:
            return messages, system_prompt

        # Separate system message from conversation
        system_msg = None
        rest = []
        for m in messages:
            if m.get("role") == "system":
                system_msg = m
            else:
                rest.append(m)

        if not rest:
            return messages, system_prompt

        # Protect head and tail
        head = rest[:self.protect_first_n]
        tail = rest[-self.protect_last_n:]
        middle = rest[self.protect_first_n:-self.protect_last_n]

        if not middle:
            return messages, system_prompt

        # Summarise middle into a condensed exchange
        summary = self._summarise_middle(middle)

        # Rebuild message list
        compressed = []
        if system_msg:
            compressed.append(system_msg)
        compressed.extend(head)
        compressed.append({"role": "user", "content": summary})
        compressed.extend(tail)

        self.compression_count += 1
        logger.info(
            "Context compressed: %d → %d messages (head=%d tail=%d middle=%d→1)",
            len(messages), len(compressed),
            self.protect_first_n, self.protect_last_n, len(middle),
        )

        return compressed, system_prompt

    def _summarise_middle(self, messages: list[dict[str, Any]]) -> str:
        """Condense a list of conversation messages into a one-paragraph summary."""
        parts = []
        for m in messages:
            role = m.get("role", "?")
            content = m.get("content", "")
            tc = m.get("tool_calls")

            if isinstance(content, list):
                # Content parts list — extract text parts
                text_parts = [
                    p.get("text", "") for p in content
                    if isinstance(p, dict) and p.get("type") == "text"
                ]
                content = " ".join(text_parts)
            elif isinstance(content, dict) and content.get("_multimodal"):
                content = content.get("text_summary") or "[multimodal]"

            if isinstance(content, str):
                # Truncate long tool results
                if role == "tool" and len(content) > 500:
                    content = content[:500] + "..."
                if content.strip():
                    parts.append(f"[{role}]: {content[:300]}")

            if tc:
                names = [t.get("function", {}).get("name", "?") for t in tc]
                parts.append(f"[assistant called tools: {', '.join(names)}]")

        merged = "\n".join(parts[-20:])  # keep last 20 entries max
        return f"[Summarised earlier context]\n{merged}\n[/Summarised]"
