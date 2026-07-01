"""
Pulse Agent — MCP Client (Model Context Protocol).

Connects to MCP servers over stdio transport and exposes their tools
as Pulse Agent tools. Supports command-type servers (stdio subprocess).

Design:
- MCPClient: single server connection (subprocess stdio)
- MCPRegistry: manages multiple connections, tool discovery
- Auto-registers MCP tools into Pulse's tool registry
- Timeout handling, reconnection, error propagation
- Compatible with any MCP server implementing the stdio transport
"""

from __future__ import annotations

import json
import logging
import os
import shlex
import signal
import subprocess
import sys
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Optional

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════════════════
# MCP Protocol helpers
# ═══════════════════════════════════════════════════════════════════════════════

JSONRPC_VERSION = "2.0"

# Method names
METHOD_INITIALIZE = "initialize"
METHOD_LIST_TOOLS = "tools/list"
METHOD_CALL_TOOL = "tools/call"
METHOD_NOTIFICATION = "notifications/initialized"

# Timeouts
_INIT_TIMEOUT = 10.0
_TOOL_LIST_TIMEOUT = 15.0
_TOOL_CALL_TIMEOUT = 60.0


def _make_request(method: str, params: dict | None = None) -> str:
    """Create a JSON-RPC 2.0 request string."""
    msg = {
        "jsonrpc": JSONRPC_VERSION,
        "id": str(uuid.uuid4()),
        "method": method,
    }
    if params is not None:
        msg["params"] = params
    return json.dumps(msg) + "\n"


def _make_notification(method: str, params: dict | None = None) -> str:
    """Create a JSON-RPC 2.0 notification (no id)."""
    msg = {
        "jsonrpc": JSONRPC_VERSION,
        "method": method,
    }
    if params is not None:
        msg["params"] = params
    return json.dumps(msg) + "\n"


def _parse_response(line: str) -> dict | None:
    """Parse a JSON-RPC 2.0 response line.

    Returns None if the line is a notification (no id field).
    Raises ValueError on malformed JSON.
    """
    if not line or not line.strip():
        return None
    try:
        msg = json.loads(line)
    except json.JSONDecodeError:
        return None

    # Notifications have no id
    if "id" not in msg:
        return None

    return msg


# ═══════════════════════════════════════════════════════════════════════════════
# Data models
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class MCPToolDef:
    """Definition of a tool exposed by an MCP server."""
    name: str
    description: str
    input_schema: dict
    server_name: str = ""


@dataclass
class MCPServerConfig:
    """Configuration for a single MCP server connection."""
    name: str
    command: str
    args: list[str] = field(default_factory=list)
    env: dict[str, str] | None = None
    disabled: bool = False

    @classmethod
    def from_dict(cls, name: str, config: dict) -> MCPServerConfig:
        """Create from a config dict (from YAML/config file)."""
        return cls(
            name=name,
            command=config.get("command", ""),
            args=config.get("args", []),
            env=config.get("env"),
            disabled=config.get("disabled", False),
        )


# ═══════════════════════════════════════════════════════════════════════════════
# MCPClient (single server)
# ═══════════════════════════════════════════════════════════════════════════════

class MCPClient:
    """Manages a single MCP server connection over stdio.

    Usage::

        client = MCPClient("sqlite", command="uvx", args=["mcp-sqlite"])
        client.connect()
        tools = client.list_tools()
        result = client.call_tool("read_query", {"query": "SELECT * FROM users"})
        client.disconnect()
    """

    def __init__(
        self,
        server_name: str,
        command: str,
        args: list[str] | None = None,
        env: dict[str, str] | None = None,
    ):
        self.server_name = server_name
        self.command = command
        self.args = args or []
        self.env = env

        self._process: subprocess.Popen | None = None
        self._lock = threading.Lock()
        self._pending_responses: dict[str, threading.Event] = {}
        self._responses: dict[str, dict] = {}
        self._reader_thread: threading.Thread | None = None
        self._connected = False
        self._tools: list[MCPToolDef] = []
        self._server_info: dict = {}
        self._shutdown = threading.Event()

    # ── Lifecycle ───────────────────────────────────────────────────────────

    def connect(self, timeout: float = _INIT_TIMEOUT) -> bool:
        """Spawn the server subprocess and initialize the MCP connection.

        Returns True on successful handshake.
        Raises MCPConnectionError on failure.
        """
        if self._connected:
            return True

        self._shutdown.clear()

        # Resolve command path
        command_path = self._resolve_command(self.command)
        if not command_path:
            raise MCPConnectionError(
                f"MCP server '{self.server_name}': command '{self.command}' not found in PATH"
            )

        # Build environment
        proc_env = os.environ.copy()
        if self.env:
            proc_env.update(self.env)

        logger.info(
            "Starting MCP server '%s': %s %s",
            self.server_name, command_path, " ".join(
                shlex.quote(a) for a in self.args
            ),
        )

        try:
            self._process = subprocess.Popen(
                [command_path, *self.args],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                env=proc_env,
                text=True,
                bufsize=1,  # line-buffered
            )
        except FileNotFoundError:
            raise MCPConnectionError(
                f"MCP server '{self.server_name}': command '{self.command}' not found"
            )
        except OSError as e:
            raise MCPConnectionError(
                f"MCP server '{self.server_name}': failed to spawn: {e}"
            )

        # Start reader thread
        self._reader_thread = threading.Thread(
            target=self._reader_loop,
            name=f"mcp-reader-{self.server_name}",
            daemon=True,
        )
        self._reader_thread.start()

        # Send initialize request
        init_result = self._send_request(
            METHOD_INITIALIZE,
            {
                "protocolVersion": "2025-03-26",
                "capabilities": {},
                "clientInfo": {
                    "name": "pulse-agent",
                    "version": "1.0.0",
                },
            },
            timeout=timeout,
        )

        if init_result is None:
            self.disconnect()
            raise MCPConnectionError(
                f"MCP server '{self.server_name}': initialize timed out"
            )

        if "error" in init_result:
            error_msg = init_result["error"].get("message", str(init_result["error"]))
            self.disconnect()
            raise MCPConnectionError(
                f"MCP server '{self.server_name}': initialize error: {error_msg}"
            )

        # Extract server info
        result = init_result.get("result", {})
        server_info = result.get("serverInfo", {})
        self._server_info = {
            "name": server_info.get("name", ""),
            "version": server_info.get("version", ""),
        }
        logger.info(
            "MCP server '%s' connected: %s v%s",
            self.server_name,
            self._server_info.get("name", "?"),
            self._server_info.get("version", "?"),
        )

        # Send initialized notification
        self._send_notification(METHOD_NOTIFICATION)

        # Discover tools
        self._discover_tools()

        self._connected = True
        return True

    def disconnect(self) -> None:
        """Gracefully shut down the server connection."""
        self._connected = False
        self._shutdown.set()

        if self._process:
            try:
                # Send EOF to stdin
                if self._process.stdin:
                    self._process.stdin.close()

                # Wait for process to exit
                self._process.wait(timeout=5.0)
            except subprocess.TimeoutExpired:
                # Force kill
                if self._process.poll() is None:
                    if sys.platform == "win32":
                        self._process.kill()
                    else:
                        os.kill(self._process.pid, signal.SIGKILL)
                    self._process.wait(timeout=3.0)
            except Exception as e:
                logger.debug("Error disconnecting MCP server: %s", e)
            finally:
                self._process = None

        # Wake up any pending waiters
        with self._lock:
            for event in self._pending_responses.values():
                event.set()
            self._pending_responses.clear()

    @property
    def connected(self) -> bool:
        return self._connected

    @property
    def tools(self) -> list[MCPToolDef]:
        return list(self._tools)

    # ── Tool operations ─────────────────────────────────────────────────────

    def list_tools(self) -> list[MCPToolDef]:
        """List tools provided by this MCP server.

        Returns cached list if already discovered.
        """
        if not self._tools:
            self._discover_tools()
        return list(self._tools)

    def call_tool(
        self,
        tool_name: str,
        arguments: dict[str, Any] | None = None,
        timeout: float = _TOOL_CALL_TIMEOUT,
    ) -> dict:
        """Call a tool on the MCP server.

        Returns the result dict from the server.
        Raises MCPToolNotFoundError if the tool doesn't exist.
        Raises MCPCallError if the call fails.
        """
        if not self._connected:
            raise MCPConnectionError(
                f"MCP server '{self.server_name}' is not connected"
            )

        result = self._send_request(
            METHOD_CALL_TOOL,
            {
                "name": tool_name,
                "arguments": arguments or {},
            },
            timeout=timeout,
        )

        if result is None:
            raise MCPCallError(
                f"MCP server '{self.server_name}': tool '{tool_name}' call timed out"
            )

        if "error" in result:
            error_data = result["error"]
            raise MCPCallError(
                f"MCP server '{self.server_name}': tool '{tool_name}' error: "
                f"{error_data.get('message', str(error_data))}"
            )

        return result.get("result", {})

    # ── Internal ────────────────────────────────────────────────────────────

    def _resolve_command(self, command: str) -> str | None:
        """Resolve a command to its absolute path.

        Handles: uvx, npx, pipx, and system PATH binaries.
        """
        # If already absolute, check existence
        if os.path.isabs(command):
            return command if os.path.isfile(command) else None

        # Check PATH
        path_dirs = os.environ.get("PATH", "").split(os.pathsep)
        for d in path_dirs:
            full = os.path.join(d, command)
            if os.path.isfile(full):
                return full
            # Windows: try with .exe
            if sys.platform == "win32":
                full_exe = full + ".exe"
                if os.path.isfile(full_exe):
                    return full_exe
                full_cmd = full + ".cmd"
                if os.path.isfile(full_cmd):
                    return full_cmd

        # Check if it's uvx/npx — these might be managed by uv/pnpm
        # but still might not be in PATH as actual binaries
        return shutil_which(command)

    def _send_request(
        self,
        method: str,
        params: dict | None = None,
        timeout: float = _TOOL_CALL_TIMEOUT,
    ) -> dict | None:
        """Send a JSON-RPC request and wait for the response.

        Returns the response dict, or None on timeout.
        """
        request_str = _make_request(method, params)
        request_id = json.loads(request_str)["id"]

        event = threading.Event()
        with self._lock:
            self._pending_responses[request_id] = event

        try:
            self._write(request_str)
            if not event.wait(timeout=timeout):
                with self._lock:
                    self._pending_responses.pop(request_id, None)
                return None

            with self._lock:
                return self._responses.pop(request_id, None)
        except Exception as e:
            with self._lock:
                self._pending_responses.pop(request_id, None)
            raise MCPConnectionError(
                f"MCP server '{self.server_name}': request failed: {e}"
            )

    def _send_notification(self, method: str, params: dict | None = None) -> None:
        """Send a JSON-RPC notification (fire-and-forget)."""
        notification_str = _make_notification(method, params)
        self._write(notification_str)

    def _write(self, data: str) -> None:
        """Write to server's stdin."""
        if self._process is None or self._process.stdin is None:
            raise MCPConnectionError(
                f"MCP server '{self.server_name}': stdin not available"
            )
        try:
            self._process.stdin.write(data)
            self._process.stdin.flush()
        except BrokenPipeError:
            raise MCPConnectionError(
                f"MCP server '{self.server_name}': broken pipe (process exited)"
            )

    def _reader_loop(self) -> None:
        """Background thread: reads JSON-RPC responses from server stdout."""
        if self._process is None or self._process.stdout is None:
            return

        try:
            for line in self._process.stdout:
                if self._shutdown.is_set():
                    break

                if not line or not line.strip():
                    continue

                msg = _parse_response(line)
                if msg is None:
                    # Notification or malformed — skip
                    continue

                msg_id = msg.get("id")
                if msg_id is None:
                    continue

                with self._lock:
                    self._responses[str(msg_id)] = msg
                    event = self._pending_responses.pop(str(msg_id), None)
                    if event:
                        event.set()
        except (ValueError, OSError) as e:
            if not self._shutdown.is_set():
                logger.debug("MCP reader error: %s", e)

    def _discover_tools(self) -> None:
        """Fetch the tool list from the server."""
        result = self._send_request(
            METHOD_LIST_TOOLS,
            timeout=_TOOL_LIST_TIMEOUT,
        )

        if result is None:
            logger.warning("MCP server '%s': tools/list timed out", self.server_name)
            return

        if "error" in result:
            logger.warning(
                "MCP server '%s': tools/list error: %s",
                self.server_name, result["error"],
            )
            return

        tools_data = result.get("result", {}).get("tools", [])
        self._tools = [
            MCPToolDef(
                name=t.get("name", ""),
                description=t.get("description", ""),
                input_schema=t.get("inputSchema", t.get("parameters", {})),
                server_name=self.server_name,
            )
            for t in tools_data
        ]
        logger.info(
            "MCP server '%s': discovered %d tools",
            self.server_name, len(self._tools),
        )


def shutil_which(cmd: str) -> str | None:
    """Safe shutil.which import (not at module level)."""
    import shutil
    return shutil.which(cmd)


# ═══════════════════════════════════════════════════════════════════════════════
# MCPRegistry (multi-server manager)
# ═══════════════════════════════════════════════════════════════════════════════

class MCPRegistry:
    """Manages multiple MCP server connections and tool registrations.

    Usage::

        registry = MCPRegistry()
        registry.add_server("sqlite", "uvx", ["mcp-sqlite"])
        registry.connect_all()
        all_tools = registry.get_all_tools()
        result = registry.call_tool("sqlite", "read_query", {"query": "..."})
    """

    def __init__(self):
        self._servers: dict[str, MCPClient] = {}
        self._lock = threading.Lock()

    # ── Server management ───────────────────────────────────────────────────

    def add_server(
        self,
        name: str,
        command: str,
        args: list[str] | None = None,
        env: dict[str, str] | None = None,
    ) -> None:
        """Register an MCP server configuration."""
        with self._lock:
            self._servers[name] = MCPClient(
                server_name=name,
                command=command,
                args=args or [],
                env=env,
            )

    def add_server_from_config(self, config: MCPServerConfig) -> None:
        """Register a server from an MCPServerConfig object."""
        if config.disabled:
            return
        self.add_server(config.name, config.command, config.args, config.env)

    def remove_server(self, name: str) -> None:
        """Disconnect and remove an MCP server."""
        with self._lock:
            client = self._servers.pop(name, None)
        if client:
            client.disconnect()

    def get_server(self, name: str) -> MCPClient | None:
        """Get a server client by name."""
        with self._lock:
            return self._servers.get(name)

    def list_servers(self) -> list[str]:
        """List all registered server names."""
        with self._lock:
            return list(self._servers.keys())

    # ── Connection lifecycle ────────────────────────────────────────────────

    def connect_all(self) -> dict[str, bool]:
        """Connect all registered servers.

        Returns dict mapping server_name → success(bool).
        """
        results = {}
        with self._lock:
            server_names = list(self._servers.keys())

        for name in server_names:
            client = self._servers[name]
            try:
                client.connect()
                results[name] = True
                logger.info("MCP server '%s' connected", name)
            except MCPConnectionError as e:
                results[name] = False
                logger.warning("MCP server '%s' failed to connect: %s", name, e)

        return results

    def disconnect_all(self) -> None:
        """Disconnect all servers."""
        with self._lock:
            clients = list(self._servers.values())
        for client in clients:
            try:
                client.disconnect()
            except Exception as e:
                logger.debug("Error disconnecting MCP server: %s", e)

    # ── Tool operations ─────────────────────────────────────────────────────

    def get_all_tools(self) -> list[MCPToolDef]:
        """Get all tools from all connected servers."""
        all_tools = []
        with self._lock:
            clients = list(self._servers.values())
        for client in clients:
            all_tools.extend(client.tools)
        return all_tools

    def has_tool(self, tool_name: str) -> bool:
        """Check if any server provides a tool with this name."""
        with self._lock:
            clients = list(self._servers.values())
        for client in clients:
            for t in client.tools:
                if t.name == tool_name:
                    return True
        return False

    def call_tool(
        self,
        server_name: str,
        tool_name: str,
        arguments: dict[str, Any] | None = None,
        timeout: float = _TOOL_CALL_TIMEOUT,
    ) -> dict:
        """Call a tool on a specific MCP server.

        Raises MCPToolNotFoundError if the server or tool doesn't exist.
        """
        client = self.get_server(server_name)
        if client is None:
            raise MCPToolNotFoundError(
                f"MCP server '{server_name}' not registered"
            )
        if not client.connected:
            client.connect()
        return client.call_tool(tool_name, arguments, timeout=timeout)


# ═══════════════════════════════════════════════════════════════════════════════
# Pulse Agent tool integration
# ═══════════════════════════════════════════════════════════════════════════════

def create_mcp_tool_proxies(registry: MCPRegistry) -> dict[str, Callable]:
    """Create callable tool functions from all registered MCP tools.

    Each MCP tool is wrapped into a function that calls registry.call_tool()
    with the right server name.

    Returns a dict of tool_name → callable suitable for Pulse's tool registry.
    """
    proxies = {}
    for tool in registry.get_all_tools():
        # Create the proxy function with server_name captured
        server = tool.server_name
        tname = tool.name

        def make_proxy(server_name: str, tool_name: str):
            def proxy(**kwargs):
                try:
                    result = registry.call_tool(server_name, tool_name, kwargs)
                    return json.dumps(result, default=str)
                except (MCPConnectionError, MCPCallError, MCPToolNotFoundError) as e:
                    return json.dumps({"error": str(e)})
            proxy.__name__ = tool_name
            proxy.__doc__ = tool.description
            return proxy

        proxies[tname] = make_proxy(server, tname)

    return proxies


# ═══════════════════════════════════════════════════════════════════════════════
# Exceptions
# ═══════════════════════════════════════════════════════════════════════════════

class MCPError(Exception):
    """Base MCP error."""
    pass


class MCPConnectionError(MCPError):
    """MCP server connection failed."""
    pass


class MCPCallError(MCPError):
    """MCP tool call failed."""
    pass


class MCPToolNotFoundError(MCPError):
    """MCP tool not found on any server."""
    pass
