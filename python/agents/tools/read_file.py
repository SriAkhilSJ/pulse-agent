"""Read a text file with line count limit. Use instead of `cat`, `type`, or `Get-Content`."""
import os

name = "readFile"
description = "Read contents of a text file, optionally limiting lines. Use this instead of shell commands (cat, type, Get-Content) — it returns structured output with line numbers and total count."
parameters = {
    "type": "object",
    "properties": {
        "path": {"type": "string", "description": "Absolute file path to read"},
        "maxLines": {"type": "integer", "description": "Max lines to return", "default": 200},
    },
    "required": ["path"],
}

def run(path: str, maxLines: int = 200) -> str:
    if not os.path.isfile(path):
        return f"Error: file not found: {path}"
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            lines = f.readlines()
        total = len(lines)
        if total > maxLines:
            shown = lines[:maxLines]
            result = "".join(shown)
            result += f"\n... ({total - maxLines} more lines, {total} total)"
        else:
            result = "".join(lines)
        return f"--- {path} ({total} lines) ---\n{result}"
    except Exception as e:
        return f"Error reading {path}: {e}"
