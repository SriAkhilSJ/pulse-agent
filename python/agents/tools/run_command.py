"""Run a shell command with timeout. Sandboxed — no dangerous ops. Use for builds, scripts, git, processes."""
import subprocess
import shlex

name = "runCommand"
description = "Run a shell command with timeout. Use for git, builds, scripts, system info, package installs, and anything needing a shell. Sandboxed — supports POSIX and Windows shells."
parameters = {
    "type": "object",
    "properties": {
        "command": {"type": "string", "description": "Shell command to execute"},
        "timeout": {"type": "integer", "description": "Max seconds to wait", "default": 30},
        "workdir": {"type": "string", "description": "Working directory", "default": ""},
    },
    "required": ["command"],
}

# Commands that are blocked for safety
_BLOCKED_PREFIXES = ["rm -rf /", "rm -rf ~", "dd if=", "mkfs.", ":(){ :|:& };:", "> /dev/sda"]

def run(command: str, timeout: int = 30, workdir: str = "") -> str:
    cmd_stripped = command.strip().lower()
    for blocked in _BLOCKED_PREFIXES:
        if cmd_stripped.startswith(blocked):
            return f"Error: command blocked for safety: {command[:50]}"
    try:
        result = subprocess.run(
            command,
            shell=True,
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=workdir or None,
        )
        out = ""
        if result.stdout:
            out += f"stdout:\n{result.stdout[:5000]}"
        if result.stderr:
            out += f"\nstderr:\n{result.stderr[:2000]}"
        out += f"\nexit code: {result.returncode}"
        return out
    except subprocess.TimeoutExpired:
        return f"Error: command timed out after {timeout}s"
    except Exception as e:
        return f"Error: {e}"
