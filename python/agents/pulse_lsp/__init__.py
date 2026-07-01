"""Pulse LSP — Language Server Protocol integration.

Lazy singleton: call get_service() to get the process-wide LSPService.
Diagnostics are available to the agent for context enrichment.

Architecture:
    get_service() → LSPService → _BackgroundLoop (async loop in daemon thread)
                                 └── LSPClient per (server_id, workspace_root)
                                         └── child process (pyright, gopls, etc.)

Usage:
    from pulse_lsp import get_service

    svc = get_service()
    if svc and svc.enabled_for("/path/to/file.py"):
        diags = svc.open_and_diagnostics("/path/to/file.py")
        for d in diags:
            print(d["message"])
"""
from __future__ import annotations

import atexit
import logging
import threading
from typing import Optional

from pulse_lsp.manager import LSPService

logger = logging.getLogger("pulse.lsp")

_service: Optional[LSPService] = None
_atexit_done = False
_lock = threading.Lock()


def get_service(workspace_path: str = "") -> Optional[LSPService]:
    """Return the process-wide LSP service singleton.

    Created lazily on first call. Returns None when creation fails.
    Registers an atexit handler to clean up server subprocesses.
    """
    global _service, _atexit_done
    if _service is not None:
        return _service if _service.is_active() else None
    with _lock:
        if _service is not None:
            return _service if _service.is_active() else None
        try:
            _service = LSPService(enabled=True)
        except Exception as e:
            logger.debug("LSP service creation failed: %s", e)
            return None
        if not _atexit_done:
            atexit.register(_atexit_shutdown)
            _atexit_done = True
    return _service if _service.is_active() else None


def shutdown_service() -> None:
    """Tear down the LSP service. Safe to call multiple times."""
    global _service
    with _lock:
        svc = _service
        _service = None
    if svc is not None:
        try:
            svc.shutdown()
        except Exception as e:
            logger.debug("LSP shutdown: %s", e)


def _atexit_shutdown() -> None:
    try:
        shutdown_service()
    except Exception as e:
        logger.debug("atexit LSP shutdown: %s", e)


__all__ = ["get_service", "shutdown_service", "LSPService"]
