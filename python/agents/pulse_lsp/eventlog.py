"""Structured logging with dedup for the LSP layer.

Maintains once-per-X dedup sets so steady-state events are DEBUG while
state transitions are INFO/WARNING once per session.
"""
from __future__ import annotations

import logging
import os
import threading
from typing import Tuple

event_log = logging.getLogger("pulse.lsp")

_lock = threading.Lock()
_announced_active: set = set()
_announced_unavailable: set = set()
_announced_no_root: set = set()
_announced_no_server: set = set()


def _short_path(file_path: str) -> str:
    if not file_path:
        return file_path
    try:
        rel = os.path.relpath(file_path)
    except ValueError:
        return file_path
    return rel if not rel.startswith(".." + os.sep) else file_path


def _emit(server_id: str, level: int, message: str) -> None:
    event_log.log(level, "lsp[%s] %s", server_id, message)


def _once(bucket: set, key: Tuple) -> bool:
    with _lock:
        if key in bucket:
            return False
        bucket.add(key)
        return True


def log_clean(server_id: str, file_path: str) -> None:
    _emit(server_id, logging.DEBUG, f"clean ({_short_path(file_path)})")


def log_disabled(server_id: str, file_path: str, reason: str) -> None:
    _emit(server_id, logging.DEBUG, f"skipped: {reason} ({_short_path(file_path)})")


def log_active(server_id: str, workspace_root: str) -> None:
    key = (server_id, workspace_root)
    if _once(_announced_active, key):
        _emit(server_id, logging.INFO, f"active for {workspace_root}")
    else:
        _emit(server_id, logging.DEBUG, f"reused client for {workspace_root}")


def log_diagnostics(server_id: str, file_path: str, count: int) -> None:
    _emit(server_id, logging.INFO, f"{count} diags ({_short_path(file_path)})")


def log_no_project_root(server_id: str, file_path: str) -> None:
    key = (server_id, file_path)
    if _once(_announced_no_root, key):
        _emit(server_id, logging.INFO, f"no project root ({_short_path(file_path)})")
    else:
        _emit(server_id, logging.DEBUG, f"no project root ({_short_path(file_path)})")


def log_server_unavailable(server_id: str, binary_or_pkg: str) -> None:
    key = (server_id, binary_or_pkg)
    if _once(_announced_unavailable, key):
        _emit(server_id, logging.WARNING, f"server unavailable: {binary_or_pkg}")
    else:
        _emit(server_id, logging.DEBUG, f"server still unavailable: {binary_or_pkg}")


def log_no_server_configured(server_id: str) -> None:
    if _once(_announced_no_server, (server_id,)):
        _emit(server_id, logging.WARNING, "no server configured")


def log_timeout(server_id: str, file_path: str, kind: str = "diagnostics") -> None:
    _emit(server_id, logging.WARNING, f"{kind} timed out ({_short_path(file_path)})")


def log_server_error(server_id: str, file_path: str, exc: BaseException) -> None:
    _emit(server_id, logging.WARNING, f"error for {_short_path(file_path)}: {type(exc).__name__}: {exc}")


def log_spawn_failed(server_id: str, workspace_root: str, exc: BaseException) -> None:
    _emit(server_id, logging.WARNING, f"spawn/init failed for {workspace_root}: {type(exc).__name__}: {exc}")


def reset_caches() -> None:
    with _lock:
        _announced_active.clear()
        _announced_unavailable.clear()
        _announced_no_root.clear()
        _announced_no_server.clear()


__all__ = [
    "event_log", "log_clean", "log_disabled", "log_active",
    "log_diagnostics", "log_no_project_root", "log_server_unavailable",
    "log_no_server_configured", "log_timeout", "log_server_error",
    "log_spawn_failed", "reset_caches",
]
