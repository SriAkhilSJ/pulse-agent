"""Debug utilities for the agent — introspection, variable inspection, error analysis.

Mirrors Hermes tools/debug_helpers.py (105 lines).
"""
from __future__ import annotations

import json
import sys
import os
import inspect
import traceback
from typing import Any, Optional

name = "debugHelpers"
description = "Debug utilities: inspect Python objects, get variable state, analyze stack traces, measure execution time. Use during development to understand runtime behavior."
parameters = {
    "type": "object",
    "properties": {
        "action": {
            "type": "string",
            "enum": [
                "inspect_object", "trace_stack", "list_vars",
                "measure_time", "dump_env", "analyze_error",
            ],
            "description": "Debug action to perform",
        },
        "object_expr": {
            "type": "string",
            "description": "Python expression for the object to inspect (for inspect_object action)",
            "default": "",
        },
        "code": {
            "type": "string",
            "description": "Code to time execution of (for measure_time action)",
            "default": "",
        },
        "error_text": {
            "type": "string",
            "description": "Error traceback or message to analyze (for analyze_error action)",
            "default": "",
        },
    },
    "required": ["action"],
}


def run(
    action: str,
    object_expr: str = "",
    code: str = "",
    error_text: str = "",
) -> str:
    if action == "inspect_object":
        return _inspect_object(object_expr)
    elif action == "trace_stack":
        return _trace_stack()
    elif action == "list_vars":
        return _list_vars()
    elif action == "measure_time":
        return _measure_time(code)
    elif action == "dump_env":
        return _dump_env()
    elif action == "analyze_error":
        return _analyze_error(error_text)
    else:
        return json.dumps({"error": f"Unknown action: {action}"})


def _inspect_object(expr: str) -> str:
    """Inspect a Python object and return its attributes and type info."""
    if not expr:
        return json.dumps({"error": "object_expr is required for inspect_object"})

    try:
        obj = eval(expr, globals())
    except Exception as e:
        return json.dumps({"error": f"Cannot evaluate '{expr}': {e}"})

    info = {
        "expression": expr,
        "type": type(obj).__name__,
        "module": getattr(type(obj), "__module__", ""),
    }

    if isinstance(obj, (int, float, bool, str)):
        info["value"] = repr(obj)
    elif isinstance(obj, (list, tuple)):
        info["length"] = len(obj)
        info["first_3"] = [repr(x) for x in obj[:3]]
        info["last_3"] = [repr(x) for x in obj[-3:]] if len(obj) > 3 else None
    elif isinstance(obj, dict):
        info["length"] = len(obj)
        info["keys"] = list(obj.keys())[:20]
    elif isinstance(obj, (type, object)):
        # Get public attributes
        attrs = {}
        for name in dir(obj):
            if not name.startswith("_"):
                try:
                    val = getattr(obj, name)
                    attrs[name] = type(val).__name__
                except Exception:
                    attrs[name] = "<error>"
        info["attributes"] = attrs
        # Get methods
        methods = []
        for name in dir(obj):
            if not name.startswith("_") and callable(getattr(obj, name, None)):
                methods.append(name)
        if methods:
            info["methods"] = methods[:30]

    return json.dumps(info, indent=2, default=str)


def _trace_stack() -> str:
    """Return the current call stack."""
    frames = inspect.stack()
    stack = []
    for i, frame in enumerate(frames):
        stack.append({
            "level": i,
            "file": frame.filename,
            "line": frame.lineno,
            "function": frame.function,
        })
    return json.dumps({"stack": stack}, indent=2)


def _list_vars() -> str:
    """List local variables in the caller's frame."""
    # Walk up to find a frame with interesting locals
    frame = inspect.currentframe()
    if frame is None:
        return json.dumps({"error": "Cannot get current frame"})

    # Go up 2 frames to skip _list_vars and run
    frame = frame.f_back
    if frame is None:
        return json.dumps({"error": "No parent frame"})

    locals_info = {}
    for name, val in frame.f_locals.items():
        if not name.startswith("_"):
            try:
                if isinstance(val, (int, float, bool, str)):
                    locals_info[name] = repr(val)
                elif isinstance(val, (list, tuple, dict, set)):
                    locals_info[name] = f"{type(val).__name__}({len(val)})"
                else:
                    locals_info[name] = type(val).__name__
            except Exception:
                locals_info[name] = "<error>"

    return json.dumps({"locals": locals_info}, indent=2, default=str)


def _measure_time(code_str: str) -> str:
    """Measure execution time of a Python code snippet."""
    if not code_str:
        return json.dumps({"error": "code is required for measure_time"})

    import time
    import textwrap

    code_str = textwrap.dedent(code_str)

    # Warmup
    try:
        compile(code_str, "<measure>", "exec")
    except SyntaxError as e:
        return json.dumps({"error": f"Syntax error: {e}"})

    # Time execution
    times = []
    for _ in range(3):
        start = time.perf_counter()
        try:
            exec(code_str)
        except Exception as e:
            return json.dumps({"error": f"Execution error: {e}"})
        elapsed = time.perf_counter() - start
        times.append(elapsed)

    result = {
        "code": code_str[:200],
        "runs": 3,
        "min_s": round(min(times), 6),
        "max_s": round(max(times), 6),
        "avg_s": round(sum(times) / len(times), 6),
        "total_s": round(sum(times), 6),
    }
    return json.dumps(result, indent=2)


def _dump_env() -> str:
    """Dump environment variables and system info."""
    import platform

    env = {}
    # Safe env vars (no secrets)
    safe_keys = [
        "PATH", "HOME", "USERPROFILE", "SHELL", "TERM", "LANG",
        "PWD", "OLDPWD", "PULSE_HOME", "HERMES_HOME",
        "PYTHONPATH", "VIRTUAL_ENV", "CONDA_PREFIX",
        "USER", "USERNAME", "COMPUTERNAME", "HOSTNAME",
    ]
    for key in safe_keys:
        val = os.environ.get(key, "")
        if val:
            env[key] = val

    # System info
    info = {
        "environment": env,
        "system": {
            "platform": platform.platform(),
            "python": platform.python_version(),
            "executable": sys.executable,
            "cwd": os.getcwd(),
        },
    }
    return json.dumps(info, indent=2, default=str)


def _analyze_error(error_text: str) -> str:
    """Analyze an error traceback and extract useful info."""
    if not error_text:
        return json.dumps({"error": "error_text is required for analyze_error"})

    analysis = {
        "original": error_text[:1000],
    }

    # Try to parse traceback
    tb_lines = error_text.strip().split("\n")

    # Extract error type and message (last non-empty line)
    error_line = ""
    for line in reversed(tb_lines):
        line = line.strip()
        if line and not line.startswith("Traceback") and not line.startswith(" "):
            error_line = line
            break
    analysis["error_summary"] = error_line

    # Extract file/line info from traceback
    frames = []
    for line in tb_lines:
        m = re.search(r'File "([^"]+)", line (\d+), in (.+)', line)
        if m:
            frames.append({
                "file": m.group(1),
                "line": int(m.group(2)),
                "function": m.group(3),
            })
    if frames:
        analysis["traceback_frames"] = frames

    # Classify error type
    for exc_type in [
        "ImportError", "ModuleNotFoundError", "FileNotFoundError",
        "TypeError", "ValueError", "KeyError", "IndexError", "AttributeError",
        "SyntaxError", "IndentationError", "NameError",
        "RuntimeError", "TimeoutError", "ConnectionError",
        "ZeroDivisionError", "OverflowError", "RecursionError",
        "json.JSONDecodeError", "subprocess.CalledProcessError",
    ]:
        if exc_type in error_text:
            analysis["error_type"] = exc_type
            break

    if not analysis.get("error_type"):
        analysis["error_type"] = "Unknown"

    # Suggestions
    suggestions = []
    et = analysis.get("error_type", "")
    if "ModuleNotFoundError" in et or "ImportError" in et:
        suggestions.append("Install the missing module with pip install <module>")
    if "FileNotFoundError" in et:
        suggestions.append("Check the file path exists before accessing it")
    if "SyntaxError" in et or "IndentationError" in et:
        suggestions.append("Check for mismatched indentation or missing parentheses")
    if "NameError" in et:
        suggestions.append("The variable/function was not defined in the current scope")
    if analysis.get("error_summary"):
        if "connection" in analysis["error_summary"].lower():
            suggestions.append("Check network connectivity or URL")
    if suggestions:
        analysis["suggestions"] = suggestions

    return json.dumps(analysis, indent=2)


import re  # noqa: E402 — needed for _analyze_error
