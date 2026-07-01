"""Terminal — alias for runCommand. Run a shell command and return stdout/stderr."""
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))
from run_command import run as _run_command

name = "terminal"
description = "Run a shell command and return stdout/stderr. Timeout enforced. Use this to execute commands, create folders, run scripts, etc."
parameters = {
    "type": "object",
    "properties": {
        "command": {"type": "string", "description": "Shell command to execute"},
        "timeout": {"type": "integer", "description": "Max seconds to wait", "default": 30},
        "cwd": {"type": "string", "description": "Working directory", "default": ""},
    },
    "required": ["command"],
}


def run(command: str, timeout: int = 30, cwd: str = "") -> str:
    """Delegate to runCommand, mapping cwd -> workdir."""
    return _run_command(command=command, timeout=timeout, workdir=cwd)
