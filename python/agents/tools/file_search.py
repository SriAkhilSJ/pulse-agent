"""File content and name search. Ripgrep-backed.

Use this instead of shell commands (grep, find, rg) for searching file
contents and finding files by glob pattern. Returns structured results.

Mirrors Hermes tools/tool_search.py (735 lines) + search_files tool.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
from pathlib import Path
from typing import Optional

name = "searchFiles"
description = "Search file contents or find files by name. Use this instead of grep/rg/find/ls in terminal. Content search uses ripgrep (rg) for fast regex matching. File search uses glob patterns (e.g. '*.py', '*config*'). Results sorted by modification time."
parameters = {
    "type": "object",
    "properties": {
        "pattern": {
            "type": "string",
            "description": "Regex pattern for content search, or glob pattern (e.g., '*.py') for file search",
        },
        "target": {
            "type": "string",
            "enum": ["content", "files"],
            "description": "'content' searches inside file contents, 'files' searches for files by name",
            "default": "content",
        },
        "path": {
            "type": "string",
            "description": "Directory or file to search in (default: current working directory)",
            "default": ".",
        },
        "file_glob": {
            "type": "string",
            "description": "Filter files by pattern in grep mode (e.g., '*.py' to only search Python files)",
            "default": "",
        },
        "limit": {
            "type": "integer",
            "description": "Maximum number of results to return (default: 50)",
            "default": 50,
        },
        "offset": {
            "type": "integer",
            "description": "Skip first N results for pagination (default: 0)",
            "default": 0,
        },
        "output_mode": {
            "type": "string",
            "enum": ["content", "files_only", "count"],
            "description": "Output format: 'content' shows matching lines, 'files_only' lists file paths, 'count' shows match counts per file",
            "default": "content",
        },
        "context": {
            "type": "integer",
            "description": "Number of context lines before and after each match (grep mode only, default: 0)",
            "default": 0,
        },
    },
    "required": ["pattern"],
}


def run(
    pattern: str,
    target: str = "content",
    path: str = ".",
    file_glob: str = "",
    limit: int = 50,
    offset: int = 0,
    output_mode: str = "content",
    context: int = 0,
) -> str:
    limit = min(max(limit, 1), 500)
    offset = max(offset, 0)

    search_path = os.path.abspath(os.path.expanduser(path))
    if not os.path.exists(search_path):
        return json.dumps({"error": f"Path not found: {search_path}", "matches": []})

    if target == "files":
        return _search_files(pattern, search_path, limit, offset)
    else:
        return _search_content(pattern, search_path, file_glob, limit, offset, output_mode, context)


def _search_files(pattern: str, search_path: str, limit: int, offset: int) -> str:
    """Find files by glob pattern, sorted by modification time."""
    from pathlib import Path

    base = Path(search_path)
    matches = []

    try:
        files = list(base.rglob(pattern)) if "**" in pattern else list(base.glob(pattern))
    except (PermissionError, OSError) as e:
        return json.dumps({"error": f"Search error: {e}", "matches": []})

    # Filter to files only
    files = [f for f in files if f.is_file()]

    # Sort by modification time (newest first)
    files.sort(key=lambda f: f.stat().st_mtime, reverse=True)

    # Apply offset + limit
    total = len(files)
    files = files[offset:offset + limit]

    for f in files:
        try:
            stat = f.stat()
            matches.append({
                "path": str(f),
                "size": stat.st_size,
                "modified": stat.st_mtime,
            })
        except OSError:
            matches.append({"path": str(f)})

    return json.dumps({
        "matches": matches,
        "total": total,
        "returned": len(matches),
        "offset": offset,
    }, indent=2, default=str)


def _search_content(
    pattern: str,
    search_path: str,
    file_glob: str,
    limit: int,
    offset: int,
    output_mode: str,
    context: int,
) -> str:
    """Search inside file contents using ripgrep (rg) or grep fallback."""
    # Try ripgrep first
    rg_path = _which("rg") or _which("rg.exe")
    if rg_path:
        return _search_with_rg(pattern, search_path, file_glob, limit, offset, output_mode, context, rg_path)

    # Fallback to grep
    grep_path = _which("grep") or _which("findstr")
    if grep_path:
        return _search_with_grep(pattern, search_path, file_glob, limit, offset, output_mode, context, grep_path)

    return json.dumps({
        "error": "No search tool found. Install ripgrep (rg) or ensure grep is on PATH.",
        "matches": [],
    })


def _search_with_rg(
    pattern: str, path: str, file_glob: str,
    limit: int, offset: int, output_mode: str, context: int,
    rg_path: str,
) -> str:
    """Search using ripgrep."""
    cmd = [rg_path, "--no-heading", "--color", "never"]
    if context > 0:
        cmd.extend(["-C", str(context)])
    if output_mode == "count":
        cmd.append("--count")
    elif output_mode == "files_only":
        cmd.append("--files-with-matches")
    if file_glob:
        cmd.extend(["--glob", file_glob])
    cmd.append(pattern)
    cmd.append(path)

    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=30,
        )
    except subprocess.TimeoutExpired:
        return json.dumps({"error": "Search timed out after 30s", "matches": []})
    except FileNotFoundError:
        return json.dumps({"error": "rg binary not found at resolved path", "matches": []})

    if result.returncode not in (0, 1):  # 1 = no matches
        return json.dumps({"error": f"rg failed: {result.stderr[:200]}", "matches": []})

    output = result.stdout
    if not output.strip():
        return json.dumps({"matches": [], "total": 0})

    # Parse and limit results
    lines = output.splitlines()
    total = len(lines)

    if output_mode == "count":
        # Format: file:count
        matches = []
        for line in lines[offset:offset + limit]:
            if ":" in line:
                fpath, count = line.rsplit(":", 1)
                matches.append({"file": fpath, "count": int(count)})
        return json.dumps({"matches": matches, "total": total})

    if output_mode == "files_only":
        matches = [{"file": line} for line in lines[offset:offset + limit]]
        return json.dumps({"matches": matches, "total": total})

    # Content mode: parse file:line:content or file:line:column:content
    matches = []
    for line in lines[offset:offset + limit]:
        match = _parse_rg_line(line)
        if match:
            matches.append(match)

    return json.dumps({
        "matches": matches,
        "total": total,
        "returned": len(matches),
        "offset": offset,
    }, indent=2)


def _parse_rg_line(line: str) -> Optional[dict]:
    """Parse a ripgrep output line into structured data."""
    # Format: path:line:content  or  path:line:column:content
    parts = line.split(":", 3)
    if len(parts) >= 3:
        fpath = parts[0]
        line_no = parts[1]
        content = parts[2] if len(parts) >= 3 else ""
        if line_no.isdigit():
            return {
                "file": fpath,
                "line": int(line_no),
                "content": content,
            }
    return None


def _search_with_grep(
    pattern: str, path: str, file_glob: str,
    limit: int, offset: int, output_mode: str, context: int,
    grep_path: str,
) -> str:
    """Search using grep (fallback when rg unavailable)."""
    import platform
    is_win = platform.system() == "Windows"

    cmd = [grep_path]
    if is_win:
        # findstr on Windows
        cmd.extend(["/n", "/s"])
        if context > 0:
            cmd.extend(["/B"])
        cmd.append(pattern)
        # findstr doesn't support file_glob natively
        cmd.append(os.path.join(path, "*"))
    else:
        # POSIX grep
        cmd.extend(["-rn"])
        if context > 0:
            cmd.extend(["-C", str(context)])
        if output_mode == "count":
            cmd.append("-c")
        elif output_mode == "files_only":
            cmd.append("-l")
        cmd.append(pattern)
        if file_glob:
            cmd.extend(["--include", file_glob])
        cmd.append(path)

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    except subprocess.TimeoutExpired:
        return json.dumps({"error": "Search timed out after 30s", "matches": []})

    output = result.stdout
    if not output.strip():
        return json.dumps({"matches": [], "total": 0})

    lines = output.splitlines()
    total = len(lines)
    matches = [{"raw": line} for line in lines[offset:offset + limit]]

    return json.dumps({
        "matches": matches,
        "total": total,
        "engine": "grep",
    }, indent=2)


def _which(name: str) -> Optional[str]:
    import shutil
    return shutil.which(name)
