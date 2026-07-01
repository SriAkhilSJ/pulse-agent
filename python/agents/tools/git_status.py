"""
Pulse Agent — gitStatus tool.

Quick git status summary for the current workspace.
Returns branch, changed files, ahead/behind status, and recent commits.

Design:
- Runs git commands through terminal/subprocess
- Returns structured data
- Graceful failure for non-git directories
"""

from __future__ import annotations

import json
import logging
import subprocess
from pathlib import Path

logger = logging.getLogger(__name__)

name = "gitStatus"
description = "Get a quick summary of the git repository status: current branch, changed files, staged/unstaged changes, ahead/behind status, and recent commits. Run this before describing or making changes to understand the current state."
category = "code_read"
danger_level = "safe"
keywords = ("git", "status", "branch", "commit", "diff", "repository")

parameters = {
    "type": "object",
    "properties": {
        "path": {
            "type": "string",
            "description": "Path to the git repository. Defaults to the workspace root or current directory.",
            "default": "",
        },
    },
}


def _run_git(cmd: list[str], cwd: str) -> tuple[str, str, int]:
    """Run a git command and return (stdout, stderr, returncode)."""
    try:
        result = subprocess.run(
            ["git"] + cmd,
            capture_output=True,
            text=True,
            cwd=cwd,
            timeout=10,
        )
        return result.stdout.strip(), result.stderr.strip(), result.returncode
    except FileNotFoundError:
        return "", "git not found", -1
    except subprocess.TimeoutExpired:
        return "", "git command timed out", -1


def _find_git_root(path: str) -> str | None:
    """Find the git root directory."""
    stdout, _, rc = _run_git(["rev-parse", "--show-toplevel"], path)
    return stdout if rc == 0 else None


def run(path: str = "") -> str:
    """Get git status summary."""
    work_path = path or "."

    root = _find_git_root(work_path)
    if not root:
        return json.dumps({
            "error": "Not a git repository (or no git found)",
            "is_git_repo": False,
        })

    # Branch
    branch, _, _ = _run_git(["rev-parse", "--abbrev-ref", "HEAD"], root)

    # Status (porcelain)
    status_out, _, _ = _run_git(["status", "--porcelain"], root)
    changed_files = []
    if status_out:
        for line in status_out.split("\n"):
            if line.strip():
                xy = line[:2]
                filepath = line[3:]
                changed_files.append({
                    "status": _decode_status(xy),
                    "file": filepath,
                })

    # Staged / unstaged counts
    staged = sum(1 for f in changed_files if f["status"][0].isupper() or f["status"] == "added")
    unstaged = sum(1 for f in changed_files if not (f["status"][0].isupper() or f["status"] == "added"))

    # Ahead/behind
    ahead_behind, _, _ = _run_git(
        ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
        root,
    )
    ahead = 0
    behind = 0
    if ahead_behind:
        parts = ahead_behind.split()
        if len(parts) == 2:
            behind, ahead = int(parts[0]), int(parts[1])

    # Recent commits
    log_out, _, _ = _run_git(
        ["log", "--oneline", "-5", "--no-decorate"], root,
    )
    recent_commits = log_out.split("\n") if log_out else []

    return json.dumps({
        "is_git_repo": True,
        "root": root,
        "branch": branch,
        "changed_files": len(changed_files),
        "staged": staged,
        "unstaged": unstaged,
        "ahead": ahead,
        "behind": behind,
        "files": changed_files[:50],  # limit to 50 files
        "recent_commits": recent_commits,
    }, indent=2)


def _decode_status(code: str) -> str:
    """Decode git status porcelain code."""
    mapping = {
        "??": "untracked",
        "M ": "modified",
        " M": "unstaged_modified",
        "A ": "added",
        "D ": "deleted",
        " D": "unstaged_deleted",
        "R ": "renamed",
        "C ": "copied",
        "U": "unmerged",
        "!!": "ignored",
    }
    return mapping.get(code, code.strip() or "unknown")
