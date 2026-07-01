"""Workspace and project-root resolution for LSP.

Two concerns:
1. Git worktree gate — LSP only runs inside git repos
2. Per-language nearest-root walk — finds pyproject.toml, Cargo.toml, etc.

Mirrors Hermes agent/lsp/workspace.py (223 lines → 265 lines).
"""
from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Iterable, Optional, Tuple

logger = logging.getLogger("pulse.lsp.workspace")

# Cache: path → (worktree_root, is_git)
_cache: dict = {}


def normalize_path(path: str) -> str:
    """Normalize a path for use as a stable map key.

    Resolves ~, makes absolute, collapses . and .. — but does NOT
    resolve symlinks (LSP servers care about the canonical path).
    """
    return os.path.abspath(os.path.expanduser(path))


def find_git_root(start: str) -> Optional[str]:
    """Walk up from start looking for .git (file or directory).

    Returns the directory containing .git, or None if no git root
    is found before hitting the filesystem root.
    """
    try:
        start_path = Path(normalize_path(start))
        if start_path.is_file():
            start_path = start_path.parent
    except (OSError, RuntimeError, ValueError):
        return None

    cached = _cache.get(str(start_path))
    if cached is not None:
        return cached

    cur = start_path
    for _ in range(64):
        git_marker = cur / ".git"
        try:
            if git_marker.exists():
                resolved = str(cur)
                _cache[str(start_path)] = resolved
                return resolved
        except OSError:
            break
        parent = cur.parent
        if parent == cur:
            break
        cur = parent

    _cache[str(start_path)] = None
    return None


def is_inside_workspace(path: str, workspace_root: str) -> bool:
    """Return True iff path is inside (or equal to) workspace_root.

    Uses absolute paths but does NOT resolve symlinks — conservative
    interpretation matching LSP server behaviour.
    """
    p = normalize_path(path)
    root = normalize_path(workspace_root)
    if p == root:
        return True
    try:
        common = os.path.commonpath([p, root])
    except ValueError:
        # Different drives on Windows
        return False
    return common == root


def nearest_root(
    start: str,
    markers: Iterable[str],
    *,
    excludes: Optional[Iterable[str]] = None,
    ceiling: Optional[str] = None,
) -> Optional[str]:
    """Walk up from start looking for marker files.

    Returns the directory containing the first matched marker, or None.
    If excludes is provided and an exclude marker matches first, returns None.
    """
    start_path = Path(normalize_path(start))
    try:
        if start_path.is_file():
            start_path = start_path.parent
    except (OSError, RuntimeError, ValueError):
        return None
    ceiling_path = Path(normalize_path(ceiling)) if ceiling else None
    markers_list = list(markers)
    excludes_list = list(excludes) if excludes else []

    cur = start_path
    for _ in range(64):
        for exc in excludes_list:
            try:
                if (cur / exc).exists():
                    return None
            except OSError:
                continue
        for marker in markers_list:
            try:
                if (cur / marker).exists():
                    return str(cur)
            except OSError:
                continue
        if ceiling_path is not None and cur == ceiling_path:
            return None
        parent = cur.parent
        if parent == cur:
            return None
        cur = parent
    return None


def resolve_workspace(
    file_path: str,
    *,
    cwd: Optional[str] = None,
) -> Tuple[Optional[str], bool]:
    """Resolve the workspace root for a file.

    Returns (workspace_root, gated_in).
    gated_in is True only when the file is inside a git worktree.

    The cwd path takes precedence — if the agent was launched in a git
    project, that worktree is the workspace. Falls back to the file's
    own location.
    """
    cwd = cwd or os.getcwd()
    cwd_root = find_git_root(cwd)
    if cwd_root is not None:
        if is_inside_workspace(file_path, cwd_root):
            return cwd_root, True
    file_root = find_git_root(file_path)
    if file_root is not None:
        return file_root, True
    return None, False


def clear_cache() -> None:
    """Clear the workspace-resolution cache — called on service shutdown."""
    _cache.clear()


__all__ = [
    "find_git_root", "is_inside_workspace", "nearest_root",
    "normalize_path", "resolve_workspace", "clear_cache",
]
