"""List files in a directory. Use instead of `ls`, `dir`, or `Get-ChildItem` in the terminal."""
import os
import json
from pathlib import Path

name = "listFiles"
description = "List files and directories at a given path with sizes and timestamps. Use this instead of shell commands (ls, dir, Get-ChildItem) for directory listings."
parameters = {
    "type": "object",
    "properties": {
        "path": {"type": "string", "description": "Directory path to list"},
        "recursive": {"type": "boolean", "description": "List recursively", "default": False},
        "pattern": {"type": "string", "description": "Optional glob filter e.g. '*.py'", "default": ""},
    },
    "required": ["path"],
}

def run(path: str, recursive: bool = False, pattern: str = "") -> str:
    root = Path(path)
    if not root.exists():
        return f"Error: path not found: {path}"
    if not root.is_dir():
        return f"Error: not a directory: {path}"

    entries = []
    if recursive:
        for f in root.rglob(pattern if pattern else "*"):
            if f.is_file():
                size = f.stat().st_size
                mtime = f.stat().st_mtime
                entries.append({"name": str(f.relative_to(root)), "size": size, "modified": mtime})
    else:
        for f in root.iterdir():
            size = f.stat().st_size if f.is_file() else 0
            mtime = f.stat().st_mtime
            entries.append({"name": f.name, "size": size, "is_dir": f.is_dir(), "modified": mtime})

    entries.sort(key=lambda x: x["name"])
    return json.dumps({"path": path, "entries": entries, "total": len(entries)}, indent=2)
