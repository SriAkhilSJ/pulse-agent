"""Diff-aware line-shift map for cross-edit LSP delta filtering.

Builds a callable that maps pre-edit line numbers to post-edit line numbers
using difflib.SequenceMatcher. Diagnostics in deleted regions return None.
"""
from __future__ import annotations

import difflib
from typing import Any, Callable, Dict, List, Optional


def build_line_shift(pre_text: str, post_text: str) -> Callable[[int], Optional[int]]:
    """Build a pre→post line number mapper.

    Lines are 0-indexed (LSP wire format). Returns None for deleted lines.
    """
    pre_lines = pre_text.splitlines() if pre_text else []
    post_lines = post_text.splitlines() if post_text else []
    if pre_lines == post_lines:
        return lambda line: line

    sm = difflib.SequenceMatcher(a=pre_lines, b=post_lines, autojunk=False)
    opcodes = sm.get_opcodes()

    def shift(line: int) -> Optional[int]:
        for tag, i1, i2, j1, j2 in opcodes:
            if i1 <= line < i2:
                if tag == "equal":
                    return line - i1 + j1
                if tag in ("delete", "replace"):
                    return None
            if line < i1:
                break
        return max(0, len(post_lines) - 1) if post_lines else None
    return shift


def shift_diagnostic_range(diag: Dict[str, Any], shift: Callable[[int], Optional[int]]) -> Optional[Dict[str, Any]]:
    """Remap a diagnostic's range through shift. Returns None if line was deleted."""
    rng = diag.get("range") or {}
    start = rng.get("start") or {}
    end = rng.get("end") or {}
    pre_start = int(start.get("line", 0))
    pre_end = int(end.get("line", pre_start))

    new_start = shift(pre_start)
    if new_start is None:
        return None
    new_end = shift(pre_end)
    if new_end is None:
        new_end = new_start

    shifted = dict(diag)
    shifted["range"] = {
        "start": {"line": new_start, "character": int(start.get("character", 0))},
        "end": {"line": new_end, "character": int(end.get("character", 0))},
    }
    return shifted


def shift_baseline(baseline: List[Dict[str, Any]], shift: Callable[[int], Optional[int]]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for d in baseline:
        if isinstance(d, dict):
            s = shift_diagnostic_range(d, shift)
            if s is not None:
                out.append(s)
    return out


__all__ = ["build_line_shift", "shift_diagnostic_range", "shift_baseline"]
