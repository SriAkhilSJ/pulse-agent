"""LSP context bridge — exposes diagnostics to the agent.

Two integration points:
1. A tool (`lspDiag`) that the agent can call to get diagnostics for a file
2. Auto-enrichment: diagnostics are collected when the agent reads/modifies files
"""
from __future__ import annotations

import logging
import os
from typing import Dict, List, Optional

from pulse_lsp import get_service

logger = logging.getLogger("pulse.lsp.context")

# Cache diagnostics per file so repeated reads don't re-spawn LSP
_diag_cache: Dict[str, List[dict]] = {}
_cache_version: Dict[str, int] = {}  # file path -> call count


def diagnostics_for(file_path: str, force: bool = False) -> List[dict]:
    """Get LSP diagnostics for a file path.

    Cached — second call for same path returns cached result unless force=True.
    Returns empty list on any failure (never raises).
    """
    abs_path = os.path.abspath(file_path)

    if not force and abs_path in _diag_cache:
        return _diag_cache[abs_path]

    try:
        svc = get_service()
        if svc is None:
            return []
        if not svc.enabled_for(abs_path):
            return []
        diags = svc.open_and_diagnostics(abs_path)
        _diag_cache[abs_path] = diags
        return diags
    except Exception as e:
        logger.debug("LSP diagnostics failed for %s: %s", abs_path, e)
        return []


def diagnostic_summary(file_path: str) -> str:
    """Return a human-readable summary string or empty string if clean."""
    diags = diagnostics_for(file_path)
    if not diags:
        return ""

    errors = sum(1 for d in diags if d.get("severity") == 1)
    warnings = sum(1 for d in diags if d.get("severity") == 2)
    infos = sum(1 for d in diags if d.get("severity") in (3, 4))
    total = len(diags)

    lines = [f"[LSP] {os.path.basename(file_path)}: {total} diagnostic(s)"]
    if errors:
        lines.append(f"  {errors} error(s)")
    if warnings:
        lines.append(f"  {warnings} warning(s)")
    if infos:
        lines.append(f"  {infos} info(s)")

    # Show first 3
    shown = 0
    for d in diags:
        if shown >= 3:
            if total > shown:
                lines.append(f"  ... and {total - shown} more")
            break
        rng = d.get("range", {})
        start = rng.get("start", {})
        line = start.get("line", 0) + 1
        sev = {1: "E", 2: "W", 3: "I", 4: "H"}.get(d.get("severity"), "?")
        msg = d.get("message", "").split("\n")[0][:200]
        code = d.get("code", "")
        code_str = f"[{code}] " if code else ""
        lines.append(f"  {sev}:{line} {code_str}{msg}")
        shown += 1

    return "\n".join(lines)


def batch_diagnostics(file_paths: List[str]) -> Dict[str, str]:
    """Get diagnostic summaries for multiple files at once.

    Returns dict of path -> summary (empty string = clean).
    """
    result: Dict[str, str] = {}
    for fp in file_paths:
        summary = diagnostic_summary(fp)
        if summary:
            result[fp] = summary
    return result


def clear_cache() -> None:
    _diag_cache.clear()
    _cache_version.clear()


# ── Tool definition for the agent loop ───────────────────────────────────

# Tool name for the agent to call
TOOL_NAME = "lspDiag"
TOOL_DESCRIPTION = (
    "Run LSP diagnostics on a file and return errors/warnings. "
    "Use this to check for code issues before or after editing a file. "
    "Returns a structured summary of diagnostics at the given path."
)
TOOL_PARAMETERS = {
    "type": "object",
    "properties": {
        "path": {
            "type": "string",
            "description": "Absolute file path to run LSP diagnostics on",
        },
        "force": {
            "type": "boolean",
            "description": "If true, re-runs LSP even if cached result exists",
            "default": False,
        },
        "summary_only": {
            "type": "boolean",
            "description": "If true, return human-readable summary; if false, return full diagnostic data",
            "default": True,
        },
    },
    "required": ["path"],
}


def run_lsp_tool(path: str, force: bool = False, summary_only: bool = True) -> str:
    """Execute the lspDiag tool and return a string result."""
    if not os.path.isabs(path):
        # Try to resolve relative to cwd
        path = os.path.abspath(path)
    if not os.path.isfile(path):
        return f"Error: file not found: {path}"

    if summary_only:
        return diagnostic_summary(path) or f"[LSP] {os.path.basename(path)}: clean (no diagnostics)"
    else:
        diags = diagnostics_for(path, force=force)
        if not diags:
            return f"[LSP] {os.path.basename(path)}: clean (no diagnostics)"
        import json
        return json.dumps({"path": path, "diagnostics": diags, "count": len(diags)}, indent=2)


def register_lsp_tool(tool_registry: dict) -> dict:
    """Register the LSP diagnostic tool into a tool registry.

    Call from the agent loop to add LSP capabilities.
    """
    try:
        from tools import Tool
    except ImportError:
        # Fallback: define a minimal Tool-like wrapper
        class Tool:
            def __init__(self, name, description, parameters, run_fn):
                self.name = name
                self.description = description
                self.parameters = parameters
                self.run_fn = run_fn
            def to_openai_format(self):
                return {
                    "type": "function",
                    "function": {"name": self.name, "description": self.description, "parameters": self.parameters},
                }
            def execute(self, **kwargs):
                return self.run_fn(**kwargs)

    tool_registry[TOOL_NAME] = Tool(
        name=TOOL_NAME,
        description=TOOL_DESCRIPTION,
        parameters=TOOL_PARAMETERS,
        run_fn=run_lsp_tool,
    )
    return tool_registry
