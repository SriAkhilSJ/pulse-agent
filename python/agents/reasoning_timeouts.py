"""Per-reasoning-model stale-timeout floor for known reasoning models.

Reasoning models (o1/o3, Claude Opus 4 thinking, DeepSeek R1, QwQ, etc.)
routinely exceed default stale-detector timeouts because they spend 30-120s
"thinking" before emitting the first content token.

This module provides a FLOOR that callers apply as ``max(default, floor)``.
It never overrides explicit user config and has zero effect on non-reasoning models.
"""

from __future__ import annotations

import re
from typing import Optional


# (slug, floor_seconds).  Longer slugs checked first for prefix disambiguation.
_REASONING_FLOORS: list[tuple[str, int]] = [
    # NVIDIA Nemotron
    ("nemotron-3-ultra", 600),
    ("nemotron-3-super", 600),
    ("nemotron-3-nano", 300),
    # DeepSeek
    ("deepseek-r1", 600),
    ("deepseek-reasoner", 600),
    # Qwen / QwQ
    ("qwq-32b", 300),
    ("qwen3", 180),
    # OpenAI o-series
    ("o1-pro", 600),
    ("o1-preview", 600),
    ("o1-mini", 600),
    ("o1", 600),
    ("o3-pro", 600),
    ("o3-mini", 300),
    ("o3", 600),
    ("o4-mini", 300),
    # Anthropic Claude 4.x thinking
    ("claude-opus-4", 240),
    ("claude-sonnet-4.5", 180),
    ("claude-sonnet-4.6", 180),
    # xAI Grok reasoning
    ("grok-4-fast-reasoning", 300),
    ("grok-4.20-reasoning", 300),
    ("grok-4-fast-non-reasoning", 180),
]

# Pre-compiled patterns: start-of-slug anchor + slug + end-or-separator
_PATTERN_CACHE: dict[str, re.Pattern] = {}


def _get_pattern(slug: str) -> re.Pattern:
    compiled = _PATTERN_CACHE.get(slug)
    if compiled is None:
        compiled = re.compile(
            r"(?:(?:^|/))"  # start of string or after /
            + re.escape(slug)
            + r"(?:$|[.\-_])"  # end of string or slug separator
        )
        _PATTERN_CACHE[slug] = compiled
    return compiled


def get_reasoning_stale_timeout_floor(model: object) -> Optional[float]:
    """Return the stale-timeout floor (seconds) for a known reasoning model.

    Returns ``None`` when the model is not in the allowlist, the argument
    is empty, or is not a string.  Callers apply as ``max(default, floor)``.
    """
    if not model or not isinstance(model, str):
        return None
    name = model.strip().lower()
    if not name:
        return None
    # Strip aggregator prefix (e.g. "openai/", "anthropic/")
    if "/" in name:
        name = name.rsplit("/", 1)[1]

    # Sort by slug length descending so longer slugs win (o3-mini beats o3)
    for slug, floor in sorted(_REASONING_FLOORS, key=lambda kv: -len(kv[0])):
        if _get_pattern(slug).search(name):
            return float(floor)
    return None
