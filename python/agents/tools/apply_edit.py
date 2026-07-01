"""Write content to a file. Create, overwrite, or append. Use instead of heredoc/echo redirect in shell."""
import os

name = "applyEdit"
description = "Create a new file, overwrite an existing file, or append to a file. Use this instead of shell heredoc/echo redirect — it auto-creates parent directories and reports exact byte counts."
parameters = {
    "type": "object",
    "properties": {
        "path": {"type": "string", "description": "Absolute file path to write"},
        "content": {"type": "string", "description": "Full file content"},
        "mode": {"type": "string", "enum": ["create", "overwrite", "append"], "default": "overwrite"},
    },
    "required": ["path", "content"],
}

def run(path: str, content: str, mode: str = "overwrite") -> str:
    try:
        if mode == "append":
            with open(path, "a", encoding="utf-8") as f:
                f.write(content)
            return f"Appended {len(content)} chars to {path}"
        else:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w", encoding="utf-8") as f:
                f.write(content)
            action = "Created" if not os.path.exists(path) else "Wrote"
            return f"{action} {path} ({len(content)} chars)"
    except Exception as e:
        return f"Error writing {path}: {e}"
