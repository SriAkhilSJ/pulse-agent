"""Pulse ACP Server — JSON-RPC 2.0 over stdio.

Implements the Agent Client Protocol (ACP) so the Rust surpassing-acp binary
can call the Python agent pipeline. Speaks JSON-RPC 2.0 over stdin/stdout.

Protocol:
  - initialize -> capabilities
  - tools/list -> [{name, description, inputSchema}]
  - tools/call -> tool result (streams progress via notifications)
  - notifications/initialized -> ack

Usage:
  python acp_server.py                              # stdio mode
  echo '{"id":1,"method":"tools/list","params":{}}' | python acp_server.py

Rust integration:
  PIPELINE_SCRIPT="python D:/pulse/python/agents/acp_server.py"
"""
from __future__ import annotations

import json
import os
import sys
import traceback
from pathlib import Path
from typing import Any, Optional

# Ensure agents dir is on path
_AGENTS_DIR = str(Path(__file__).parent.resolve())
if _AGENTS_DIR not in sys.path:
    sys.path.insert(0, _AGENTS_DIR)

# ── Imports (lazy: tools and pipeline may pull in heavy deps) ────────────

_TOOL_REGISTRY: Optional[dict] = None
_PIPELINE: Any = None


def _get_tools() -> dict:
    global _TOOL_REGISTRY
    if _TOOL_REGISTRY is None:
        from tools import discover_tools
        _TOOL_REGISTRY = discover_tools()
    return _TOOL_REGISTRY


def _get_pipeline():
    global _PIPELINE
    if _PIPELINE is None:
        import pipeline as p
        _PIPELINE = p
    return _PIPELINE


# ── JSON-RPC 2.0 helpers ────────────────────────────────────────────────

def _rpc_error(req_id: Any, code: int, message: str, data: Any = None) -> dict:
    err: dict = {"code": code, "message": message}
    if data is not None:
        err["data"] = data
    return {"jsonrpc": "2.0", "id": req_id, "error": err}


def _rpc_result(req_id: Any, result: Any) -> dict:
    return {"jsonrpc": "2.0", "id": req_id, "result": result}


def _rpc_notification(method: str, params: Any = None) -> dict:
    msg: dict = {"jsonrpc": "2.0", "method": method}
    if params is not None:
        msg["params"] = params
    return msg


# ── ACP method handlers ─────────────────────────────────────────────────

def handle_initialize(req_id: Any, params: dict) -> dict:
    """Capability negotiation."""
    client_info = params.get("clientInfo", {})
    _log(f"[ACP] initialize from {client_info.get('name', '?')} v{client_info.get('version', '?')}")

    return _rpc_result(req_id, {
        "protocolVersion": "0.1.0",
        "capabilities": {
            "tools": {},
            "resources": {},
            "streaming": True,
        },
        "serverInfo": {
            "name": "pulse-agent",
            "version": "1.0.0",
        },
    })


def handle_list_tools(req_id: Any, params: dict) -> dict:
    """Return all available tools in ACP format."""
    tools = _get_tools()
    result = []
    for name, tool in sorted(tools.items()):
        result.append({
            "name": name,
            "description": getattr(tool, "description", ""),
            "inputSchema": getattr(tool, "parameters", {"type": "object", "properties": {}}),
        })
    _log(f"[ACP] tools/list -> {len(result)} tools")
    return _rpc_result(req_id, {"tools": result})


def handle_call_tool(req_id: Any, params: dict) -> dict:
    """Call a tool and return the result.

    Streams progress as notifications before returning.
    """
    name = params.get("name", "")
    arguments = params.get("arguments", {})

    tools = _get_tools()
    tool = tools.get(name)
    if tool is None:
        return _rpc_error(req_id, -32602, f"Unknown tool: {name}")

    # Emit progress notification (sent to stderr so it doesn't corrupt stdout)
    _emit_notification("$/progress", {
        "type": "begin",
        "tool": name,
        "message": f"Running {name}...",
    })

    try:
        result_text = tool.execute(**arguments)
        # Truncate very large results
        if len(result_text) > 100_000:
            result_text = result_text[:100_000] + "\n… [truncated]"
        return _rpc_result(req_id, {
            "content": [{"type": "text", "text": result_text}],
            "isError": False,
        })
    except Exception as e:
        return _rpc_result(req_id, {
            "content": [{"type": "text", "text": f"Error: {e}"}],
            "isError": True,
        })


def handle_run_pipeline(req_id: Any, params: dict) -> dict:
    """Run the full pipeline (classification + agent loop) on a task."""
    task = params.get("task", "")
    context = params.get("context", "")
    platform = params.get("platform", None)

    if not task:
        return _rpc_error(req_id, -32602, "Missing required param: task")

    _emit_notification("$/progress", {
        "type": "begin",
        "tool": "pipeline",
        "message": f"Classifying: {task[:80]}...",
    })

    try:
        pipeline = _get_pipeline()
        result = pipeline.run(task, project_context=context, platform=platform)
        return _rpc_result(req_id, {
            "content": [{"type": "text", "text": json.dumps(result, indent=2)}],
            "isError": result.get("type") == "error",
        })
    except Exception as e:
        return _rpc_result(req_id, {
            "content": [{"type": "text", "text": f"Pipeline error: {e}"}],
            "isError": True,
        })


def handle_read_resource(req_id: Any, params: dict) -> dict:
    """Read a resource (file, diagnostics, etc.)."""
    uri = params.get("uri", "")
    if uri.startswith("file://"):
        path = uri[len("file://"):]
        if os.name == "nt" and path.startswith("/") and len(path) > 2 and path[2] == ":":
            path = path[1:]
        try:
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                content = f.read()
            return _rpc_result(req_id, {
                "contents": [{"uri": uri, "text": content}],
            })
        except FileNotFoundError:
            return _rpc_error(req_id, -32602, f"File not found: {path}")
        except Exception as e:
            return _rpc_error(req_id, -32603, f"Read error: {e}")

    return _rpc_error(req_id, -32602, f"Unsupported URI scheme: {uri}")


# ── Dispatch ─────────────────────────────────────────────────────────────

_METHODS = {
    "initialize": handle_initialize,
    "notifications/initialized": lambda r, p: _rpc_result(r, {}),
    "tools/list": handle_list_tools,
    "tools/call": handle_call_tool,
    "pipeline/run": handle_run_pipeline,
    "resources/read": handle_read_resource,
}


def _log(msg: str) -> None:
    """Log to stderr so JSON-RPC on stdout stays clean."""
    print(msg, file=sys.stderr, flush=True)


def _emit_notification(method: str, params: Any) -> None:
    """Send a JSON-RPC notification to the client via stderr.
    The Rust server reads stderr lines as events.
    """
    msg = json.dumps(_rpc_notification(method, params))
    print(msg, file=sys.stderr, flush=True)


def _read_message() -> Optional[dict]:
    """Read a single JSON-RPC message from stdin (newline-delimited JSON)."""
    try:
        line = sys.stdin.readline()
        if not line:
            return None
        return json.loads(line)
    except json.JSONDecodeError:
        return None


def main() -> None:
    """Enter the ACP server loop (stdio transport).

    Two modes:
      1. No args — JSON-RPC 2.0 server over stdio (each line = one request)
      2. --task TASK [--context PATH] [--platform X] — run pipeline once and exit
    """
    import argparse

    parser = argparse.ArgumentParser(description="Pulse ACP Server")
    parser.add_argument("--task", default=None, help="Run pipeline once with this task and exit")
    parser.add_argument("--context", default="", help="Workspace path for --task mode")
    parser.add_argument("--platform", default=None, choices=["cli", "ide", "api"], help="Platform hint")
    args, _ = parser.parse_known_args()

    if args.task:
        # ── Single-shot mode (compatible with Rust ACP server's handle_code_generation) ──
        _log(f"[ACP] Single-shot mode: task={args.task[:80]}...")
        pipeline = _get_pipeline()
        result = pipeline.run(args.task, project_context=args.context, platform=args.platform)
        output = json.dumps(result, indent=2)

        # Write structured result, then stderr progress
        print(output)
        print(json.dumps({"type": "result", **result}), file=sys.stderr, flush=True)
        sys.exit(0 if result.get("type") != "error" else 1)

    # ── JSON-RPC server mode (stdin/stdout line-delimited JSON) ──
    _log("[ACP] Pulse ACP server starting (JSON-RPC mode)")
    _log("[ACP] Ready — reading JSON-RPC 2.0 from stdin")

    while True:
        try:
            msg = _read_message()
        except EOFError:
            break

        if msg is None:
            break

        req_id = msg.get("id")
        method = msg.get("method", "")
        params = msg.get("params", {})

        handler = _METHODS.get(method)
        if handler is None:
            response = _rpc_error(req_id, -32601, f"Method not found: {method}")
        else:
            try:
                response = handler(req_id, params)
            except Exception as e:
                tb = traceback.format_exc()
                _log(f"[ACP] Error handling {method}: {e}\n{tb}")
                response = _rpc_error(req_id, -32603, f"Internal error: {e}")

        # Write response to stdout
        sys.stdout.write(json.dumps(response) + "\n")
        sys.stdout.flush()

    _log("[ACP] Pulse ACP server shutting down")


if __name__ == "__main__":
    main()
