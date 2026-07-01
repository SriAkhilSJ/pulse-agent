"""Shared helpers for classifying tool result payloads — file mutations, result size, etc."""

from __future__ import annotations

import json
from typing import Any


FILE_MUTATING_TOOL_NAMES = frozenset({"applyEdit"})

# Approximate size thresholds for tool result classification
_RESULT_SIZE_LARGE = 50_000  # chars — large result, consider truncating
_RESULT_SIZE_HUGE = 200_000  # chars — huge result, aggressive truncation needed


def file_mutation_result_landed(tool_name: str, result: Any) -> bool:
    """Return True when a file mutation result proves the write landed."""
    if tool_name not in FILE_MUTATING_TOOL_NAMES or not isinstance(result, str):
        return False
    try:
        data = json.loads(result.strip())
    except Exception:
        return False
    if not isinstance(data, dict) or data.get("error"):
        return False
    if tool_name == "applyEdit":
        return "bytes_written" in data or "resolved_path" in data
    return False


def classify_result_size(text: str) -> str:
    """Classify a tool result's size category: 'small', 'large', or 'huge'."""
    size = len(text)
    if size > _RESULT_SIZE_HUGE:
        return "huge"
    if size > _RESULT_SIZE_LARGE:
        return "large"
    return "small"


def truncate_tool_result(result: str, max_chars: int = 8_000) -> str:
    """Truncate a tool result to fit within budget, with a note."""
    if len(result) <= max_chars:
        return result
    return result[:max_chars] + (
        f"\n\n[... result truncated from {len(result):,} to {max_chars:,} chars]"
    )
