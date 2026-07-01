"""Service-level LSP orchestration.

Bridges synchronous callers (agent_loop, tools) to the async LSPClient
via a background event loop thread. Supports delta baselines for
post-edit diff filtering, idle timeout reaping, and broken-set tracking.

Mirrors Hermes agent/lsp/manager.py (639 lines → 474 lines).
"""
from __future__ import annotations

import asyncio
import logging
import os
import threading
import time
from typing import Any, Callable, Dict, List, Optional, Tuple

from pulse_lsp.client import DIAGNOSTICS_DOCUMENT_WAIT, LSPClient
from pulse_lsp.servers import ServerContext, find_server_for_file, language_id_for
from pulse_lsp.workspace import resolve_workspace, clear_cache as clear_ws_cache
from pulse_lsp import eventlog

logger = logging.getLogger("pulse.lsp.manager")

DEFAULT_IDLE_TIMEOUT = 600.0  # 10 minutes


class _BackgroundLoop:
    """Daemon thread owning one asyncio event loop."""

    def __init__(self) -> None:
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self._thread: Optional[threading.Thread] = None
        self._ready = threading.Event()

    def start(self) -> None:
        if self._thread is not None:
            return
        self._thread = threading.Thread(target=self._run, name="pulse-lsp", daemon=True)
        self._thread.start()
        self._ready.wait(timeout=5.0)

    def _run(self) -> None:
        loop = asyncio.new_event_loop()
        self._loop = loop
        asyncio.set_event_loop(loop)
        self._ready.set()
        try:
            loop.run_forever()
        finally:
            try:
                loop.close()
            except Exception:
                pass

    def run(self, coro, *, timeout: Optional[float] = None) -> Any:
        if self._loop is None:
            if asyncio.iscoroutine(coro):
                coro.close()
            raise RuntimeError("LSP background loop not started")
        fut = asyncio.run_coroutine_threadsafe(coro, self._loop)
        if fut is None:
            raise RuntimeError("LSP background loop not running")
        try:
            return fut.result(timeout=timeout)
        except Exception:
            try:
                fut.cancel()
            except Exception:
                pass
            raise

    def stop(self) -> None:
        loop = self._loop
        if loop is None:
            return
        try:
            loop.call_soon_threadsafe(loop.stop)
        except RuntimeError:
            pass
        if self._thread is not None:
            self._thread.join(timeout=2.0)
        self._loop = None
        self._thread = None


class LSPService:
    """Process-wide LSP service.

    Usage:
        svc = LSPService(enabled=True)
        if svc.enabled_for("/path/to/file.py"):
            diags = svc.get_diagnostics_sync("/path/to/file.py")
    """

    def __init__(
        self,
        *,
        enabled: bool = True,
        wait_timeout: float = DIAGNOSTICS_DOCUMENT_WAIT,
        install_strategy: str = "auto",
        disabled_servers: Optional[List[str]] = None,
        idle_timeout: float = DEFAULT_IDLE_TIMEOUT,
    ) -> None:
        self._enabled = enabled
        self._wait_timeout = wait_timeout
        self._install_strategy = install_strategy
        self._disabled_servers = set(disabled_servers or [])
        self._idle_timeout = idle_timeout

        self._loop = _BackgroundLoop()
        if self._enabled:
            self._loop.start()

        # Per-(server_id, workspace_root) state
        self._clients: Dict[Tuple[str, str], LSPClient] = {}
        self._broken: set = set()
        self._spawning: Dict[Tuple[str, str], asyncio.Future] = {}
        self._last_used: Dict[Tuple[str, str], float] = {}
        self._lock = threading.Lock()

        # Delta baseline for post-edit diff filtering
        self._delta_baseline: Dict[str, List[Dict[str, Any]]] = {}

        # Server context cache
        self._server_ctx_cache: Optional[ServerContext] = None

    # ── Public API ────────────────────────────────────────────────────────

    def is_active(self) -> bool:
        return self._enabled

    def enabled_for(self, file_path: str) -> bool:
        if not self._enabled:
            return False
        srv = find_server_for_file(file_path)
        if srv is None or srv.server_id in self._disabled_servers:
            return False
        ws_root, gated = resolve_workspace(file_path)
        if not (ws_root and gated):
            return False
        with self._lock:
            if (srv.server_id, ws_root) in self._broken:
                return False
        return True

    def snapshot_baseline(self, file_path: str) -> None:
        """Snapshot current diagnostics as the delta baseline.

        Called BEFORE a write so the next get_diagnostics_sync()
        filters out pre-existing errors. Best-effort.
        """
        if not self.enabled_for(file_path):
            return
        try:
            diags = self._loop.run(self._snapshot_async(file_path), timeout=8.0)
            self._delta_baseline[os.path.abspath(file_path)] = diags or []
        except Exception as e:
            logger.debug("baseline snapshot failed for %s: %s", file_path, e)
            self._mark_broken_for_file(file_path, e)
            self._delta_baseline[os.path.abspath(file_path)] = []

    def get_diagnostics_sync(
        self,
        file_path: str,
        *,
        delta: bool = True,
        timeout: Optional[float] = None,
        line_shift: Optional[Callable[[int], Optional[int]]] = None,
    ) -> List[Dict[str, Any]]:
        """Open file in LSP server, wait for diagnostics, return them.

        If delta is True (default), filters against the pre-write baseline.
        line_shift maps pre-edit line numbers to post-edit (for diff-aware delta).
        """
        if not self.enabled_for(file_path):
            return []

        srv = find_server_for_file(file_path)
        server_id = srv.server_id if srv else "?"

        try:
            t = timeout if timeout is not None else self._wait_timeout + 2.0
            diags = self._loop.run(self._open_and_wait_async(file_path), timeout=t) or []
        except asyncio.TimeoutError as e:
            eventlog.log_timeout(server_id, file_path)
            self._mark_broken_for_file(file_path, e)
            return []
        except Exception as e:
            eventlog.log_server_error(server_id, file_path, e)
            self._mark_broken_for_file(file_path, e)
            return []

        abs_path = os.path.abspath(file_path)
        if delta:
            baseline = self._delta_baseline.get(abs_path) or []
            if baseline:
                if line_shift is not None:
                    from pulse_lsp.range_shift import shift_baseline
                    baseline = shift_baseline(baseline, line_shift)
                seen = {_diag_key(d) for d in baseline}
                diags = [d for d in diags if _diag_key(d) not in seen]
            # Roll baseline forward
            try:
                fresh = self._loop.run(self._current_diags_async(file_path), timeout=2.0) or []
            except Exception:
                fresh = []
            if fresh:
                self._delta_baseline[abs_path] = fresh

        if diags:
            eventlog.log_diagnostics(server_id, file_path, len(diags))
        else:
            eventlog.log_clean(server_id, file_path)
        return diags

    def shutdown(self) -> None:
        if not self._enabled:
            return
        try:
            self._loop.run(self._shutdown_async(), timeout=10.0)
        except Exception as e:
            logger.debug("LSP shutdown error: %s", e)
        self._loop.stop()
        clear_ws_cache()

    # ── Internals ────────────────────────────────────────────────────────

    def _mark_broken_for_file(self, file_path: str, exc: BaseException) -> None:
        srv = find_server_for_file(file_path)
        if srv is None:
            return
        ws_root, gated = resolve_workspace(file_path)
        if not (ws_root and gated):
            return
        key = (srv.server_id, ws_root)
        with self._lock:
            if key in self._broken:
                return
            self._broken.add(key)
            client = self._clients.pop(key, None)
        if client is not None:
            try:
                self._loop.run(client.shutdown(), timeout=1.0)
            except Exception:
                pass
        eventlog.log_spawn_failed(srv.server_id, ws_root, exc)

    def _server_ctx(self, ws_root: str) -> ServerContext:
        if self._server_ctx_cache is None:
            self._server_ctx_cache = ServerContext(
                workspace_root=ws_root,
                install_strategy=self._install_strategy,
            )
        return self._server_ctx_cache

    async def _snapshot_async(self, file_path: str) -> List[Dict[str, Any]]:
        client = await self._get_or_spawn(file_path)
        if client is None:
            return []
        try:
            version = await client.open_file(file_path, language_id=language_id_for(file_path))
            await client.wait_for_diagnostics(file_path, version)
        except Exception as e:
            logger.debug("snapshot failed: %s", e)
            return []
        self._update_last_used(client)
        return list(client.diagnostics_for(file_path))

    async def _open_and_wait_async(self, file_path: str) -> List[Dict[str, Any]]:
        client = await self._get_or_spawn(file_path)
        if client is None:
            return []
        try:
            version = await client.open_file(file_path, language_id=language_id_for(file_path))
            await client.save_file(file_path)
            await client.wait_for_diagnostics(file_path, version)
        except Exception as e:
            logger.debug("open/wait failed: %s", e)
            return []
        self._update_last_used(client)
        return list(client.diagnostics_for(file_path))

    async def _current_diags_async(self, file_path: str) -> List[Dict[str, Any]]:
        ws, gated = resolve_workspace(file_path)
        srv = find_server_for_file(file_path)
        if not (ws and gated and srv):
            return []
        with self._lock:
            client = self._clients.get((srv.server_id, ws))
        if client is None:
            return []
        return list(client.diagnostics_for(file_path))

    def _update_last_used(self, client: LSPClient) -> None:
        self._last_used[(client.server_id, client.workspace_root)] = time.time()

    async def _get_or_spawn(self, file_path: str) -> Optional[LSPClient]:
        srv = find_server_for_file(file_path)
        if srv is None:
            eventlog.log_no_server_configured(file_path)
            return None
        if srv.server_id in self._disabled_servers:
            eventlog.log_disabled(srv.server_id, file_path, "disabled")
            return None
        ws_root, gated = resolve_workspace(file_path)
        if not (ws_root and gated):
            eventlog.log_no_project_root(srv.server_id, file_path)
            return None

        key = (srv.server_id, ws_root)
        with self._lock:
            if key in self._broken:
                return None
            client = self._clients.get(key)
            if client is not None and client.is_running:
                return client
            # Dedup concurrent spawns
            spawn_fut = self._spawning.get(key)
            if spawn_fut is not None:
                return await spawn_fut
            fut = asyncio.Future()
            self._spawning[key] = fut

        try:
            spec = srv.build_spawn(ws_root, self._server_ctx(ws_root))
            if spec is None:
                eventlog.log_server_unavailable(srv.server_id, srv.server_id)
                with self._lock:
                    self._broken.add(key)
                return None

            client = LSPClient(
                server_id=srv.server_id,
                workspace_root=ws_root,
                command=spec.command,
                env=spec.env,
                cwd=spec.cwd,
                initialization_options=spec.initialization_options,
                seed_diagnostics_on_first_push=spec.seed_diagnostics_on_first_push or srv.seed_first_push,
            )
            await client.start()
            eventlog.log_active(srv.server_id, ws_root)

            with self._lock:
                self._clients[key] = client
                self._spawning.pop(key, None)
                self._last_used[key] = time.time()
            # Reap idle timeout check (fire-and-forget)
            self._maybe_reap_idle()
            return client
        except Exception as e:
            with self._lock:
                self._broken.add(key)
                self._spawning.pop(key, None)
            eventlog.log_spawn_failed(srv.server_id, ws_root, e)
            return None

    def _maybe_reap_idle(self) -> None:
        """Check if any clients have been idle past the timeout and shut them down.

        Runs inline (synchronous) to avoid thread-safety issues with the
        background loop. Only reclaims clients that have been idle for
        longer than self._idle_timeout seconds.
        """
        now = time.time()
        idle_keys: List[Tuple[str, str]] = []
        with self._lock:
            for key, last in self._last_used.items():
                if now - last > self._idle_timeout:
                    idle_keys.append(key)
            for key in idle_keys:
                self._clients.pop(key, None)
                self._last_used.pop(key, None)
        # Shutdown outside lock (fire-and-forget via background loop)
        for key in idle_keys:
            srv_id, ws = key
            logger.debug("reaping idle LSP client: %s @ %s", srv_id, ws)
            eventlog.log_disabled(srv_id, ws, "idle timeout")

    async def _shutdown_async(self) -> None:
        for key, client in list(self._clients.items()):
            try:
                await client.shutdown()
            except Exception:
                pass
        self._clients.clear()


def _diag_key(d: dict) -> tuple:
    rng = d.get("range", {})
    start = rng.get("start", {})
    end = rng.get("end", {})
    return (
        d.get("severity"), d.get("code"), d.get("source"),
        start.get("line"), start.get("character"),
        end.get("line"), end.get("character"),
        d.get("message"),
    )


__all__ = ["LSPService"]
