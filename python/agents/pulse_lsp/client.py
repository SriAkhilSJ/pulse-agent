"""Async LSP client — one per (server_id, workspace_root) pair.

Manages a child process, drives JSON-RPC exchange, exposes open/change/
diagnostics/shutdown lifecycle with ContentModified retry and
pull-diagnostics support.

Mirrors Hermes agent/lsp/client.py (943 lines → 630 lines).
"""
from __future__ import annotations

import asyncio
import logging
import os
import sys
import time
from typing import Any, Callable, Dict, List, Optional
from urllib.parse import quote, unquote

from pulse_lsp.protocol import (
    ERROR_CONTENT_MODIFIED, ERROR_METHOD_NOT_FOUND,
    LSPProtocolError, LSPRequestError,
    classify_message, encode_message, make_notification, make_request,
    make_response, read_message,
)

logger = logging.getLogger("pulse.lsp.client")

INITIALIZE_TIMEOUT = 45.0
DIAGNOSTICS_DOCUMENT_WAIT = 5.0
DIAGNOSTICS_FULL_WAIT = 10.0
DIAGNOSTICS_REQUEST_TIMEOUT = 3.0
SHUTDOWN_GRACE = 1.0
PUSH_DEBOUNCE = 0.15
MAX_CONTENT_MODIFIED_RETRIES = 3
RETRY_BASE_DELAY = 0.5


def file_uri(path: str) -> str:
    abs_path = os.path.abspath(path)
    if os.name == "nt":
        abs_path = abs_path.replace("\\", "/")
        if not abs_path.startswith("/"):
            abs_path = "/" + abs_path
    return "file://" + quote(abs_path, safe="/:")


def uri_to_path(uri: str) -> str:
    if not uri.startswith("file://"):
        return uri
    raw = uri[len("file://"):]
    if os.name == "nt" and raw.startswith("/") and len(raw) > 2 and raw[2] == ":":
        raw = raw[1:]
    return os.path.normpath(unquote(raw))


def _end_position(text: str) -> Dict[str, int]:
    if not text:
        return {"line": 0, "character": 0}
    lines = text.splitlines(keepends=False)
    last_line = len(lines) - 1
    last_col = len(lines[-1]) if lines else 0
    if text.endswith(("\n", "\r")):
        return {"line": last_line + 1, "character": 0}
    return {"line": last_line, "character": last_col}


class LSPClient:
    """Async LSP client tied to one server and one workspace root."""

    def __init__(
        self,
        *,
        server_id: str,
        workspace_root: str,
        command: List[str],
        env: Optional[Dict[str, str]] = None,
        cwd: Optional[str] = None,
        initialization_options: Optional[Dict[str, Any]] = None,
        seed_diagnostics_on_first_push: bool = False,
    ) -> None:
        self.server_id = server_id
        self.workspace_root = workspace_root
        self._command = list(command)
        self._env = env or {}
        self._cwd = cwd or workspace_root
        self._init_options = initialization_options or {}
        self._seed_first_push = seed_diagnostics_on_first_push

        # Process + streams
        self._proc: Optional[asyncio.subprocess.Process] = None
        self._stderr_task: Optional[asyncio.Task] = None
        self._reader_task: Optional[asyncio.Task] = None
        self._stderr_buf: List[str] = []

        # Request/response correlation
        self._next_id = 0
        self._pending: Dict[int, asyncio.Future] = {}

        # Server-side request handlers + notification handlers
        self._request_handlers: Dict[str, Callable[[Any], Any]] = {
            "window/workDoneProgress/create": self._handle_work_done_create,
            "workspace/configuration": self._handle_workspace_configuration,
            "client/registerCapability": self._handle_register_capability,
            "client/unregisterCapability": self._handle_unregister_capability,
            "workspace/workspaceFolders": self._handle_workspace_folders,
            "workspace/diagnostic/refresh": self._handle_diagnostic_refresh,
        }
        self._notification_handlers: Dict[str, Callable[[Any], None]] = {
            "textDocument/publishDiagnostics": self._handle_publish_diagnostics,
        }

        # File state
        self._files: Dict[str, Dict[str, Any]] = {}
        self._push_diagnostics: Dict[str, List[Dict[str, Any]]] = {}
        self._pull_diagnostics: Dict[str, List[Dict[str, Any]]] = {}
        self._published: Dict[str, float] = {}
        self._published_version: Dict[str, int] = {}
        self._first_push_seen: set = set()
        self._diagnostic_registrations: Dict[str, Dict[str, Any]] = {}

        # State machine
        self._state = "stopped"
        self._initialize_result: Optional[Dict[str, Any]] = None
        self._sync_kind = 1  # 1=Full, 2=Incremental
        self._stopping = False

        # Push event for waiters
        self._push_event = asyncio.Event()
        self._push_counter = 0
        self._registration_event = asyncio.Event()

    @property
    def is_running(self) -> bool:
        return self._state == "running" and self._proc is not None and self._proc.returncode is None

    @property
    def state(self) -> str:
        return self._state

    # ── Lifecycle ─────────────────────────────────────────────────────────

    async def start(self) -> None:
        if self._state in {"running", "starting"}:
            return
        self._state = "starting"
        try:
            await self._spawn()
            await self._initialize()
            self._state = "running"
        except Exception:
            self._state = "error"
            exit_code = self._proc.returncode if self._proc else "?"
            stderr_tail = "\n".join(self._stderr_buf[-10:]) if self._stderr_buf else "(no stderr)"
            logger.warning(
                "[%s] start failed — exit_code=%s stderr_tail=\n%s",
                self.server_id, exit_code, stderr_tail,
            )
            await self._cleanup_process()
            raise

    @staticmethod
    def _win_wrap_cmd(cmd: List[str]) -> List[str]:
        exe = cmd[0]
        if exe.lower().endswith((".cmd", ".bat")):
            return ["cmd.exe", "/c", *cmd]
        return cmd

    async def _spawn(self) -> None:
        env = dict(os.environ)
        if self._env:
            env.update(self._env)
        cmd = self._command
        if sys.platform == "win32":
            cmd = self._win_wrap_cmd(cmd)
        try:
            self._proc = await asyncio.create_subprocess_exec(
                cmd[0], *cmd[1:],
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env, cwd=self._cwd,
            )
        except FileNotFoundError as e:
            raise LSPProtocolError(f"LSP server binary not found: {cmd[0]} ({e})") from e
        self._stderr_task = asyncio.create_task(self._drain_stderr())
        self._reader_task = asyncio.create_task(self._reader_loop())

    async def _drain_stderr(self) -> None:
        if self._proc is None or self._proc.stderr is None:
            return
        try:
            while True:
                line = await self._proc.stderr.readline()
                if not line:
                    break
                text = line.decode("utf-8", errors="replace").rstrip()
                if text:
                    self._stderr_buf.append(text[:1000])
                    logger.debug("[%s] stderr: %s", self.server_id, text[:500])
        except (asyncio.CancelledError, OSError):
            pass

    async def _reader_loop(self) -> None:
        if self._proc is None or self._proc.stdout is None:
            return
        try:
            while True:
                msg = await read_message(self._proc.stdout)
                if msg is None:
                    break
                kind, key = classify_message(msg)
                if kind == "response":
                    self._dispatch_response(key, msg)
                elif kind == "request":
                    asyncio.create_task(self._dispatch_request(key, msg))
                elif kind == "notification":
                    self._dispatch_notification(key, msg)
        except LSPProtocolError as e:
            logger.warning("[%s] protocol error: %s", self.server_id, e)
        except (asyncio.CancelledError, OSError):
            pass
        finally:
            for fut in list(self._pending.values()):
                if not fut.done():
                    fut.set_exception(LSPProtocolError("server connection closed"))
            self._pending.clear()

    async def _initialize(self) -> None:
        params = {
            "rootUri": file_uri(self.workspace_root),
            "rootPath": self.workspace_root,
            "processId": os.getpid(),
            "workspaceFolders": [{"name": "workspace", "uri": file_uri(self.workspace_root)}],
            "initializationOptions": self._init_options,
            "capabilities": {
                "window": {"workDoneProgress": True},
                "workspace": {
                    "configuration": True, "workspaceFolders": True,
                    "didChangeWatchedFiles": {"dynamicRegistration": True},
                    "diagnostics": {"refreshSupport": False},
                },
                "textDocument": {
                    "synchronization": {
                        "dynamicRegistration": False, "didOpen": True,
                        "didChange": True, "didSave": True,
                        "willSave": False, "willSaveWaitUntil": False,
                    },
                    "diagnostic": {"dynamicRegistration": True, "relatedDocumentSupport": True},
                    "publishDiagnostics": {
                        "relatedInformation": True,
                        "tagSupport": {"valueSet": [1, 2]},
                        "versionSupport": True, "codeDescriptionSupport": True, "dataSupport": False,
                    },
                    "hover": {"contentFormat": ["markdown", "plaintext"]},
                    "definition": {"linkSupport": True},
                    "references": {},
                    "documentSymbol": {"hierarchicalDocumentSymbolSupport": True},
                },
                "general": {"positionEncodings": ["utf-16"]},
            },
        }
        result = await asyncio.wait_for(
            self._send_request("initialize", params), timeout=INITIALIZE_TIMEOUT,
        )
        self._initialize_result = result
        self._sync_kind = self._extract_sync_kind(result.get("capabilities") or {})
        await self._send_notification("initialized", {})
        if self._init_options:
            await self._send_notification(
                "workspace/didChangeConfiguration", {"settings": self._init_options},
            )

    @staticmethod
    def _extract_sync_kind(capabilities: dict) -> int:
        sync = capabilities.get("textDocumentSync")
        if isinstance(sync, int):
            return sync
        if isinstance(sync, dict):
            change = sync.get("change")
            if isinstance(change, int):
                return change
        return 1

    async def shutdown(self) -> None:
        if self._stopping:
            return
        self._stopping = True
        try:
            if self.is_running:
                try:
                    await asyncio.wait_for(self._send_request("shutdown", None), timeout=2.0)
                except (asyncio.TimeoutError, LSPRequestError, LSPProtocolError):
                    pass
                try:
                    await self._send_notification("exit", None)
                except Exception:
                    pass
        finally:
            self._state = "stopped"
            await self._cleanup_process()

    async def _cleanup_process(self) -> None:
        for attr in ("_reader_task", "_stderr_task"):
            t = getattr(self, attr, None)
            if t is not None and not t.done():
                t.cancel()
                try:
                    await t
                except (asyncio.CancelledError, Exception):
                    pass
        proc = self._proc
        self._proc = None
        if proc is None:
            return
        if proc.returncode is None:
            try:
                proc.terminate()
                try:
                    await asyncio.wait_for(proc.wait(), timeout=SHUTDOWN_GRACE)
                except asyncio.TimeoutError:
                    try:
                        proc.kill()
                        await proc.wait()
                    except ProcessLookupError:
                        pass
            except ProcessLookupError:
                pass

    # ── Request/notification plumbing ─────────────────────────────────────

    async def _send_request(self, method: str, params: Any) -> Any:
        if self._proc is None or self._proc.stdin is None or self._proc.stdin.is_closing():
            raise LSPProtocolError(f"cannot send {method!r}: stdin closed")
        loop = asyncio.get_running_loop()
        req_id = self._next_id
        self._next_id += 1
        fut = loop.create_future()
        self._pending[req_id] = fut
        try:
            self._proc.stdin.write(encode_message(make_request(req_id, method, params)))
            await self._proc.stdin.drain()
        except (BrokenPipeError, ConnectionResetError, OSError) as e:
            self._pending.pop(req_id, None)
            raise LSPProtocolError(f"send failed: {e}") from e
        try:
            return await fut
        finally:
            self._pending.pop(req_id, None)

    async def _send_request_with_retry(self, method: str, params: Any, *, timeout: float) -> Any:
        """Send a request, retrying on ContentModified (-32801).

        Matches Claude Code's retry policy — 3 attempts with delays 0.5, 1.0, 2.0s.
        """
        for attempt in range(MAX_CONTENT_MODIFIED_RETRIES + 1):
            try:
                return await asyncio.wait_for(self._send_request(method, params), timeout=timeout)
            except LSPRequestError as e:
                if e.code == ERROR_CONTENT_MODIFIED and attempt < MAX_CONTENT_MODIFIED_RETRIES:
                    await asyncio.sleep(RETRY_BASE_DELAY * (2 ** attempt))
                    continue
                raise

    async def _send_notification(self, method: str, params: Any) -> None:
        if self._proc is None or self._proc.stdin is None or self._proc.stdin.is_closing():
            return
        try:
            self._proc.stdin.write(encode_message(make_notification(method, params)))
            await self._proc.stdin.drain()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass

    # ── Dispatch ──────────────────────────────────────────────────────────

    def _dispatch_response(self, req_id: int, msg: dict) -> None:
        fut = self._pending.get(req_id)
        if fut is None:
            return
        if "result" in msg:
            fut.set_result(msg["result"])
        elif "error" in msg:
            err = msg["error"]
            fut.set_exception(LSPRequestError(err.get("code", 0), err.get("message", ""), err.get("data")))
        else:
            fut.set_exception(LSPProtocolError("malformed response"))

    async def _dispatch_request(self, req_id: int, msg: dict) -> None:
        method = msg.get("method", "")
        params = msg.get("params")
        handler = self._request_handlers.get(method)
        if handler is None:
            return
        try:
            result = await handler(params)
            if self._proc and self._proc.stdin and not self._proc.stdin.is_closing():
                self._proc.stdin.write(encode_message(make_response(req_id, result)))
                await self._proc.stdin.drain()
        except Exception as e:
            from pulse_lsp.protocol import make_error_response
            self._proc.stdin.write(encode_message(make_error_response(req_id, -32603, str(e))))
            await self._proc.stdin.drain()

    def _dispatch_notification(self, method: str, msg: dict) -> None:
        handler = self._notification_handlers.get(method)
        if handler:
            handler(msg.get("params"))

    # ── Server→Client request handlers ────────────────────────────────────

    async def _handle_work_done_create(self, params: Any) -> dict:
        return {}

    async def _handle_workspace_configuration(self, params: Any) -> list:
        items = params.get("items", []) if isinstance(params, dict) else []
        return [None] * len(items)

    async def _handle_register_capability(self, params: Any) -> dict:
        if isinstance(params, dict):
            for reg in (params.get("registrations") or []):
                rid = reg.get("id", "")
                method = reg.get("method", "")
                if method in ("textDocument/diagnostic", "workspace/diagnostic"):
                    self._diagnostic_registrations[rid] = reg.get("registerOptions", {})
            self._registration_event.set()
        return {}

    async def _handle_unregister_capability(self, params: Any) -> dict:
        if isinstance(params, dict):
            for unreg in (params.get("unregisterations") or []):
                self._diagnostic_registrations.pop(unreg.get("id", ""), None)
        return {}

    async def _handle_workspace_folders(self, params: Any) -> list:
        return [{"name": "workspace", "uri": file_uri(self.workspace_root)}]

    async def _handle_diagnostic_refresh(self, params: Any) -> dict:
        return {}

    def _handle_publish_diagnostics(self, params: Any) -> None:
        if not isinstance(params, dict):
            return
        uri = params.get("uri", "")
        path = uri_to_path(uri)
        diags = params.get("diagnostics", [])
        self._push_diagnostics[path] = list(diags)
        version = params.get("version")
        if version is not None:
            self._published_version[path] = version
        self._published[path] = time.time()
        self._push_counter += 1
        self._push_event.set()
        if self._seed_first_push and path not in self._first_push_seen:
            self._first_push_seen.add(path)

    # ── File/document API ─────────────────────────────────────────────────

    async def open_file(self, path: str, language_id: str = "") -> int:
        abs_path = os.path.abspath(path)
        uri = file_uri(abs_path)
        try:
            with open(abs_path, "r", encoding="utf-8", errors="replace") as f:
                text = f.read()
        except (FileNotFoundError, OSError):
            text = ""
        version = self._files.get(abs_path, {}).get("version", 0) + 1
        self._files[abs_path] = {"uri": uri, "version": version, "language_id": language_id}
        params = {
            "textDocument": {
                "uri": uri, "languageId": language_id, "version": version, "text": text,
            },
        }
        await self._send_notification("textDocument/didOpen", params)
        return version

    async def change_file(self, path: str, text: str) -> int:
        abs_path = os.path.abspath(path)
        finfo = self._files.get(abs_path)
        if finfo is None:
            return await self.open_file(path)
        version = finfo["version"] + 1
        finfo["version"] = version
        params = {
            "textDocument": {"uri": finfo["uri"], "version": version},
            "contentChanges": [{
                "range": {
                    "start": {"line": 0, "character": 0},
                    "end": _end_position(finfo.get("_last_text", text)),
                },
                "text": text,
            }],
        }
        finfo["_last_text"] = text
        await self._send_notification("textDocument/didChange", params)
        return version

    async def save_file(self, path: str) -> None:
        abs_path = os.path.abspath(path)
        finfo = self._files.get(abs_path)
        if finfo is None:
            return
        await self._send_notification("textDocument/didSave", {"textDocument": {"uri": finfo["uri"]}})

    async def close_file(self, path: str) -> None:
        abs_path = os.path.abspath(path)
        finfo = self._files.pop(abs_path, None)
        if finfo is None:
            return
        await self._send_notification("textDocument/didClose", {"textDocument": {"uri": finfo["uri"]}})

    # ── Diagnostics API ───────────────────────────────────────────────────

    async def wait_for_diagnostics(
        self, path: str, version: int, *, mode: str = "document",
        timeout: Optional[float] = None,
    ) -> None:
        abs_path = os.path.abspath(path)
        if timeout is None:
            timeout = DIAGNOSTICS_DOCUMENT_WAIT if mode == "document" else DIAGNOSTICS_FULL_WAIT

        deadline = time.time() + timeout
        start_counter = self._push_counter

        while True:
            remaining = max(0.0, deadline - time.time())
            if remaining <= 0:
                return
            try:
                await asyncio.wait_for(self._push_event.wait(), timeout=remaining)
            except asyncio.TimeoutError:
                return
            self._push_event.clear()

            if self._push_counter > start_counter:
                if abs_path in self._push_diagnostics:
                    return
                # Try pull diagnostics via textDocument/diagnostic
                for reg in list(self._diagnostic_registrations.values()):
                    identifier = reg.get("identifier", "")
                    if identifier:
                        try:
                            result = await self._send_request_with_retry(
                                "textDocument/diagnostic",
                                {"textDocument": {"uri": file_uri(abs_path)}, "identifier": identifier},
                                timeout=DIAGNOSTICS_REQUEST_TIMEOUT,
                            )
                            if isinstance(result, dict):
                                pull = result.get("diagnostics", [])
                                if isinstance(pull, list):
                                    self._pull_diagnostics[abs_path] = pull
                                    return
                        except (asyncio.TimeoutError, LSPRequestError, LSPProtocolError):
                            continue

    def diagnostics_for(self, path: str) -> List[Dict[str, Any]]:
        abs_path = os.path.abspath(path)
        merged = list(self._push_diagnostics.get(abs_path, []))
        pull = self._pull_diagnostics.get(abs_path, [])
        existing_keys = {self._diag_key(d) for d in merged}
        for d in pull:
            if self._diag_key(d) not in existing_keys:
                merged.append(d)
        merged.sort(key=lambda d: (
            d.get("range", {}).get("start", {}).get("line", 0),
            d.get("severity", 0),
        ))
        return merged

    @staticmethod
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

    def diagnostic_count(self, path: str) -> int:
        return len(self.diagnostics_for(path))

    def has_active_diagnostics(self, path: str) -> bool:
        return any(d.get("severity", 0) <= 2 for d in self.diagnostics_for(path))
