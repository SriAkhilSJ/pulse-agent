"""
Pulse Agent — readFileLines tool.

Read specific lines from a file with offset and limit. More efficient than
readFile for large files when you only need a section.

Design:
- Uses Python stdlib (no external deps)
- Returns line numbers for context
- Handles very large files (doesn't load entire file into memory)
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

name = "readFileLines"
description = "Read a file with line numbers starting from a specific offset. More efficient than readFile for large files when you only need a section. Returns lines in 'LINE_NUM|CONTENT' format."
category = "code_read"
danger_level = "safe"
keywords = ("read", "file", "lines", "head", "tail", "section")

parameters = {
    "type": "object",
    "properties": {
        "path": {
            "type": "string",
            "description": "Absolute path to the file to read.",
        },
        "offset": {
            "type": "integer",
            "description": "Starting line number (1-indexed, default: 1).",
            "default": 1,
        },
        "limit": {
            "type": "integer",
            "description": "Maximum number of lines to return (default: 200, max: 2000).",
            "default": 200,
        },
    },
    "required": ["path"],
}


def run(path: str, offset: int = 1, limit: int = 200) -> str:
    """Read specific lines from a file."""
    file_path = Path(path)
    offset = max(1, offset)
    limit = min(max(1, limit), 2000)

    if not file_path.exists():
        return json.dumps({"error": f"File not found: {path}"})
    if not file_path.is_file():
        return json.dumps({"error": f"Not a file: {path}"})

    try:
        stat = file_path.stat()
        total_lines_estimate = max(1, stat.st_size // 40)  # rough estimate
    except OSError:
        total_lines_estimate = 0

    try:
        lines = []
        total_lines = 0
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            for i, line in enumerate(f, 1):
                total_lines = i
                if i >= offset and i < offset + limit:
                    lines.append(f"{i}|{line.rstrip()}")

        content = "\n".join(lines[-limit:])

        # Truncate if too large
        if len(content) > 100_000:
            content = content[:100_000] + f"\n... (truncated at 100k chars, file has {total_lines} lines)"

        return json.dumps({
            "content": content,
            "total_lines": total_lines,
            "offset": offset,
            "limit": limit,
            "path": path,
        })

    except UnicodeDecodeError:
        return json.dumps({"error": "File is not valid UTF-8 text"})
    except OSError as e:
        return json.dumps({"error": f"Cannot read file: {e}"})
