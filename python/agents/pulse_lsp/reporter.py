"""Diagnostic formatting and reporting for the LSP layer.

Formats raw LSP diagnostics into human-readable blocks the agent can
consume — used by the agent loop to include post-edit diagnostic context
in tool results, and by tools/lsp_diagnostics.py for structured output.

Mirrors Hermes agent/lsp/reporter.py.
"""
from __future__ import annotations

import os
import logging
from typing import Any, Dict, List, Optional

logger = logging.getLogger("pulse.lsp.reporter")

SEVERITY_LABELS = {1: "ERROR", 2: "WARN", 3: "INFO", 4: "HINT"}
SEVERITY_ICONS = {1: "🔴", 2: "🟡", 3: "ℹ️", 4: "💡"}


def format_diagnostics(
    diags: List[Dict[str, Any]],
    file_path: str,
    *,
    max_lines: int = 20,
    compact: bool = False,
) -> str:
    """Format a list of LSP diagnostics into a human-readable block.

    Args:
        diags: Raw diagnostics from LSPClient.diagnostics_for().
        file_path: The file these diagnostics apply to.
        max_lines: Max individual diagnostics to show (rest summarized).
        compact: If True, omit icons and use shorter format.

    Returns:
        A formatted string, or empty string if diags is empty.
    """
    if not diags:
        return ""

    errors = [d for d in diags if d.get("severity") == 1]
    warnings = [d for d in diags if d.get("severity") == 2]
    infos = [d for d in diags if d.get("severity") in (3, 4)]

    short_name = os.path.basename(file_path)
    icon = SEVERITY_ICONS
    lines: list[str] = []

    if compact:
        parts = []
        if errors:
            parts.append(f"{len(errors)} error(s)")
        if warnings:
            parts.append(f"{len(warnings)} warning(s)")
        if infos:
            parts.append(f"{len(infos)} info(s)")
        if parts:
            lines.append(f"[LSP] {short_name}: {', '.join(parts)}")
    else:
        lines.append(f"[LSP Diagnostics — {short_name}]")
        if errors:
            lines.append(f"  {len(errors)} error(s):")
        if warnings:
            lines.append(f"  {len(warnings)} warning(s):")
        if infos:
            lines.append(f"  {len(infos)} info(s):")

    # Show individual diagnostics (up to max_lines)
    shown = 0
    for d in diags:
        if shown >= max_lines:
            remaining = len(diags) - shown
            lines.append(f"  ... and {remaining} more diagnostic(s)")
            break

        sev = d.get("severity", 0)
        sev_label = SEVERITY_LABELS.get(sev, "DIAG")
        rng = d.get("range", {})
        start = rng.get("start", {})
        line = start.get("line", 0) + 1  # 1-indexed
        col = start.get("character", 0) + 1
        msg = (d.get("message") or "").split("\n")[0]
        code = d.get("code", "")
        source = d.get("source", "")

        if compact:
            lines.append(f"  {sev_label} L{line}:{col}  {msg[:200]}")
        else:
            prefix = f"{icon.get(sev, '▪️')} {sev_label}"
            code_str = f" [{code}]" if code else ""
            src_str = f" ({source})" if source else ""
            lines.append(f"  {prefix}{code_str} L{line}:{col}{src_str}")
            lines.append(f"         {msg[:200]}")
        shown += 1

    return "\n".join(lines)


def format_diagnostic_summary(
    diags: List[Dict[str, Any]],
    file_path: str,
) -> str:
    """Return a one-line summary of diagnostics for status display.

    Example: "LSP: 2 errors, 3 warnings in main.rs"
    """
    if not diags:
        return ""

    errors = sum(1 for d in diags if d.get("severity") == 1)
    warnings = sum(1 for d in diags if d.get("severity") == 2)
    infos = sum(1 for d in diags if d.get("severity") in (3, 4))
    short = os.path.basename(file_path)

    parts = []
    if errors:
        parts.append(f"{errors} error(s)")
    if warnings:
        parts.append(f"{warnings} warning(s)")
    if infos:
        parts.append(f"{infos} info(s)")

    return f"LSP: {', '.join(parts)} in {short}" if parts else ""


def count_by_severity(diags: List[Dict[str, Any]]) -> Dict[str, int]:
    """Return counts grouped by severity label."""
    counts: Dict[str, int] = {"ERROR": 0, "WARN": 0, "INFO": 0, "HINT": 0}
    for d in diags:
        label = SEVERITY_LABELS.get(d.get("severity", 0), "DIAG")
        counts[label] = counts.get(label, 0) + 1
    return counts


def has_active_errors(diags: List[Dict[str, Any]]) -> bool:
    """Return True if there are any ERROR-level diagnostics."""
    return any(d.get("severity") == 1 for d in diags)


__all__ = [
    "format_diagnostics", "format_diagnostic_summary",
    "count_by_severity", "has_active_errors",
]
