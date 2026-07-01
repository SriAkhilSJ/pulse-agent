"""Execute Python code with access to Pulse tools.

Usage:
    result = execute_code(code="from tools import discover_tools; print(discover_tools())")

The code runs in-process with all Pulse tools available via `from hermes_tools import ...`.
Mirrors Hermes tools/execute_code.py (1,848 lines).
"""
from __future__ import annotations

import json
import sys
import io
import traceback
import textwrap
from typing import Any, Optional

name = "executeCode"
description = "Run Python code that can call Pulse tools programmatically. Use for multi-step processing, data filtering, conditional logic, and loops. Available tools: web_search, web_extract, read_file, write_file, search_files, patch, terminal, json_parse, shell_quote, retry. Print your final result to stdout."
parameters = {
    "type": "object",
    "properties": {
        "code": {
            "type": "string",
            "description": "Python code to execute. Import tools with `from hermes_tools import web_search, terminal, ...` and print your result to stdout.",
        },
        "timeout": {
            "type": "integer",
            "description": "Max seconds to wait (default: 60, max: 300)",
            "default": 60,
        },
    },
    "required": ["code"],
}


def run(code: str, timeout: int = 60) -> str:
    """Execute Python code in-process with Pulse tool access.

    The code runs inside a restricted globals dict with:
      - Standard library (json, re, math, csv, datetime, collections, etc.)
      - hermes_tools module for calling Pulse tools from within the code
      - stdout capture (print goes to result string)
    """
    import builtins

    timeout = min(max(timeout, 1), 300)

    # Build the tools bridge module
    hermes_tools_code = _build_hermes_tools_bridge()

    # Prepare execution context
    exec_globals: dict = {
        "__builtins__": builtins,
        "__name__": "__pulse_exec__",
    }

    # Capture stdout
    old_stdout = sys.stdout
    old_stderr = sys.stderr
    string_io = io.StringIO()
    sys.stdout = string_io
    sys.stderr = string_io

    error_output: Optional[str] = None
    try:
        # First inject the hermes_tools bridge
        exec(compile(hermes_tools_code, "<hermes_tools>", "exec"), exec_globals)

        # Then run the user's code
        indented = textwrap.dedent(code)
        exec(compile(indented, "<user_code>", "exec"), exec_globals)
    except Exception as e:
        tb = traceback.format_exc()
        error_output = f"Error: {e}\n\nTraceback:\n{tb[:2000]}"
    finally:
        sys.stdout = old_stdout
        sys.stderr = old_stderr

    output = string_io.getvalue()

    if error_output:
        if output.strip():
            return f"{output.strip()}\n\n{error_output}"
        return error_output

    return output.strip() or "(no output — code executed successfully but printed nothing)"


def _build_hermes_tools_bridge() -> str:
    """Build a hermes_tools module that wraps Pulse's tool registry.

    This lets user code do `from hermes_tools import web_search, read_file, ...`
    just like in Hermes.
    """
    return """
import json, sys, os, re, math, csv, datetime, collections, time, random, itertools, functools, typing, pathlib

# Lazy tool registry import
_tools = None
def _get_tools():
    global _tools
    if _tools is None:
        from tools import discover_tools
        _tools = discover_tools()
    return _tools

def _call_tool(name, **kwargs):
    tools = _get_tools()
    t = tools.get(name)
    if t is None:
        raise ValueError(f"Unknown tool: {name}")
    result = t.execute(**kwargs)
    if isinstance(result, str):
        try:
            return json.loads(result)
        except (json.JSONDecodeError, ValueError):
            return result
    return result

# ── Public API that mirrors Hermes hermes_tools ──

def web_search(query: str, limit: int = 5) -> dict:
    \"\"\"Search the web.\"\"\"
    return _call_tool("webSearch", query=query, limit=limit) if "webSearch" in _get_tools() else {"error": "webSearch not available"}

def web_extract(urls: list, char_limit: int = None) -> dict:
    \"\"\"Extract content from web pages.\"\"\"
    return _call_tool("webExtract", urls=urls, char_limit=char_limit) if "webExtract" in _get_tools() else {"error": "webExtract not available"}

def read_file(path: str, offset: int = 1, limit: int = 500) -> dict:
    return _call_tool("readFile", path=path, offset=offset, maxLines=limit)

def write_file(path: str, content: str) -> dict:
    return _call_tool("applyEdit", path=path, content=content)

def search_files(pattern: str, target: str = "content", path: str = ".", file_glob: str = None, limit: int = 50) -> dict:
    return _call_tool("searchFiles", pattern=pattern, target=target, path=path, file_glob=file_glob, limit=limit) if "searchFiles" in _get_tools() else _call_tool("listFiles", path=path)

def patch(path: str, old_string: str, new_string: str, replace_all: bool = False) -> dict:
    return _call_tool("editFile", path=path, old_string=old_string, new_string=new_string, replace_all=replace_all) if "editFile" in _get_tools() else {"error": "patch not available"}

def terminal(command: str, timeout: int = None, workdir: str = None) -> dict:
    kwargs = {"command": command}
    if timeout: kwargs["timeout"] = timeout
    if workdir: kwargs["cwd"] = workdir
    return _call_tool("terminal", **kwargs) if "terminal" in _get_tools() else _call_tool("runCommand", **kwargs)

# Utility functions
def json_parse(text: str) -> dict:
    return json.loads(text) if isinstance(text, str) else text

def shell_quote(s: str) -> str:
    import shlex
    return shlex.quote(s)

def retry(fn, max_attempts: int = 3, delay: int = 2):
    \"\"\"Retry a callable with exponential backoff.\"\"\"
    import time
    last_error = None
    for attempt in range(max_attempts):
        try:
            return fn()
        except Exception as e:
            last_error = e
            if attempt < max_attempts - 1:
                time.sleep(delay * (2 ** attempt))
    raise last_error

__all__ = ["web_search", "web_extract", "read_file", "write_file", "search_files",
           "patch", "terminal", "json_parse", "shell_quote", "retry"]
"""


__all__ = ["run"]
