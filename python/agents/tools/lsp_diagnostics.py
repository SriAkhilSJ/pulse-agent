"""LSP diagnostics tool — get code diagnostics via language servers.

Usage:
    from tools.lsp_diagnostics import lsp_diagnostics

    result = lsp_diagnostics(path="D:/pulse/python/agents/pipeline.py")
    # Returns structured diagnostics or empty list
"""
from __future__ import annotations

import os

name = "lspDiagnostics"
description = "Get code diagnostics (errors, warnings, hints) from a language server for a source file. Opens the file in the appropriate LSP server (pyright for .py, typescript-language-server for .ts/.js, gopls for .go, rust-analyzer for .rs, clangd for .c/.cpp) and returns diagnostics with severity, line number, and message."
parameters = {
    "type": "object",
    "properties": {
        "path": {
            "type": "string",
            "description": "Absolute path to the source file to analyze",
        },
    },
    "required": ["path"],
}


def run(path: str) -> str:
    """Run LSP diagnostics on a file and return a formatted summary."""
    import json

    try:
        from pulse_lsp import get_service
    except ImportError:
        return json.dumps({"error": "LSP module not available (pulse_lsp not installed)", "tools": []})

    abs_path = os.path.abspath(path)
    if not os.path.isfile(abs_path):
        return json.dumps({"error": f"File not found: {abs_path}", "path": abs_path})

    svc = get_service()
    if svc is None:
        return json.dumps({"error": "LSP service could not be initialized", "path": abs_path})

    if not svc.enabled_for(abs_path):
        return json.dumps({
            "info": "LSP not available for this file (no git repo, no matching server, or server disabled)",
            "path": abs_path,
            "enabled": False,
        })

    # Get raw diagnostics
    diags = svc.open_and_diagnostics(abs_path)
    if not diags:
        return json.dumps({"path": abs_path, "diagnostics": [], "count": 0, "summary": "No diagnostics"})

    # Build structured result
    errors = [d for d in diags if d.get("severity") == 1]
    warnings = [d for d in diags if d.get("severity") == 2]
    infos = [d for d in diags if d.get("severity") in (3, 4)]

    simplified = []
    for d in diags:
        rng = d.get("range", {})
        start = rng.get("start", {})
        sev_label = {1: "ERROR", 2: "WARN", 3: "INFO", 4: "HINT"}.get(d.get("severity"), "DIAG")
        simplified.append({
            "severity": sev_label,
            "line": start.get("line", 0) + 1,
            "column": start.get("character", 0) + 1,
            "code": d.get("code", ""),
            "source": d.get("source", ""),
            "message": d.get("message", "").split("\n")[0],
        })

    result = {
        "path": abs_path,
        "count": len(diags),
        "errors": len(errors),
        "warnings": len(warnings),
        "infos": len(infos),
        "diagnostics": simplified,
    }
    return json.dumps(result, indent=2)
