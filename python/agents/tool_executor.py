"""Tool-call execution — sequential and concurrent dispatch.

Provides ``execute_tool_calls_sequential`` and ``execute_tool_calls_concurrent``
for the main agent loop.  Both append tool-result messages to the turn's message list.
"""

from __future__ import annotations

import concurrent.futures
import json
import logging
import time
from typing import Any, Callable, Optional

from tool_dispatch_helpers import (
    make_tool_result_message,
    should_parallelize_tool_batch,
    _get_name,
    _get_args,
)

logger = logging.getLogger(__name__)

_MAX_TOOL_WORKERS = 8


def execute_tool_calls_sequential(
    tool_calls: list,
    tool_registry: dict,
    messages: list[dict],
    *,
    emit_callback: Optional[Callable] = None,
    max_result_chars: int = 8_000,
) -> int:
    """Execute tool calls one at a time, appending results to messages.

    Args:
        tool_calls: List of tool call objects (dict or object with function attr).
        tool_registry: Dict of name -> Tool objects with execute(**kwargs) method.
        messages: Message list to append results to (mutated in-place).
        emit_callback: Optional callback for tool progress events.
        max_result_chars: Maximum chars per tool result.

    Returns:
        Number of tool calls executed.
    """
    count = 0
    for tc in tool_calls:
        name = _get_name(tc)
        try:
            raw_args = _get_args(tc)
            args = json.loads(raw_args) if isinstance(raw_args, str) else raw_args
        except json.JSONDecodeError:
            args = {}
        if not isinstance(args, dict):
            args = {}

        tc_id = tc.get("id", f"call_{int(time.time() * 1000)}") if isinstance(tc, dict) else getattr(tc, "id", f"call_{int(time.time() * 1000)}")

        # Pre-execute callback
        if emit_callback:
            try:
                emit_callback("tool_start", name, args)
            except Exception:
                pass

        # Execute
        tool = tool_registry.get(name)
        if tool is None:
            result_text = json.dumps({"error": f"Unknown tool '{name}'"})
        else:
            try:
                result_text = tool.execute(**args)
            except Exception as e:
                result_text = json.dumps({"error": str(e)})

        # Post-execute callback
        if emit_callback:
            try:
                preview = result_text[:200] if isinstance(result_text, str) else str(result_text)[:200]
                emit_callback("tool_result", name, {"result": preview, "duration": 0})
            except Exception:
                pass

        messages.append(make_tool_result_message(
            name, result_text, tc_id,
            max_chars=max_result_chars,
        ))
        count += 1

    return count


def execute_tool_calls_concurrent(
    tool_calls: list,
    tool_registry: dict,
    messages: list[dict],
    *,
    emit_callback: Optional[Callable] = None,
    max_result_chars: int = 8_000,
    max_workers: int = _MAX_TOOL_WORKERS,
) -> int:
    """Execute tool calls concurrently using a thread pool.

    Results are collected in original tool-call order.  Falls back to
    sequential if the batch contains conflicting operations.

    Args:
        tool_calls: List of tool call objects.
        tool_registry: Dict of name -> Tool objects.
        messages: Message list to append results to (mutated in-place).
        emit_callback: Optional progress callback.
        max_result_chars: Max chars per tool result.
        max_workers: Thread pool size.

    Returns:
        Number of tool calls executed.
    """
    if not should_parallelize_tool_batch(tool_calls):
        return execute_tool_calls_sequential(
            tool_calls, tool_registry, messages,
            emit_callback=emit_callback,
            max_result_chars=max_result_chars,
        )

    # Pre-parse all calls
    parsed = []
    for tc in tool_calls:
        name = _get_name(tc)
        try:
            raw_args = _get_args(tc)
            args = json.loads(raw_args) if isinstance(raw_args, str) else raw_args
        except json.JSONDecodeError:
            args = {}
        if not isinstance(args, dict):
            args = {}
        tc_id = tc.get("id", f"call_{int(time.time() * 1000)}") if isinstance(tc, dict) else getattr(tc, "id", f"call_{int(time.time() * 1000)}")
        parsed.append((name, args, tc_id))

    # Emit pre-execute callbacks
    if emit_callback:
        for name, args, _ in parsed:
            try:
                emit_callback("tool_start", name, args)
            except Exception:
                pass

    # Execute concurrently
    results: list[tuple[str, str, str, str]] = []  # (name, result, tc_id, error_or_result)

    def _execute_one(name: str, args: dict, tc_id: str) -> tuple[str, str, str, str]:
        tool = tool_registry.get(name)
        if tool is None:
            return (name, json.dumps({"error": f"Unknown tool '{name}'"}), tc_id, "error")
        try:
            result = tool.execute(**args)
            return (name, result, tc_id, "result")
        except Exception as e:
            return (name, json.dumps({"error": str(e)}), tc_id, "error")

    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as pool:
        fut_to_call = {
            pool.submit(_execute_one, name, args, tc_id): (name, tc_id)
            for name, args, tc_id in parsed
        }
        # Collect in original order
        ordered = []
        for name, args, tc_id in parsed:
            for fut in fut_to_call:
                if fut_to_call[fut][1] == tc_id and fut_to_call[fut][0] == name:
                    try:
                        ordered.append(fut.result())
                    except Exception as e:
                        ordered.append((name, json.dumps({"error": str(e)}), tc_id, "error"))
                    break

    # Emit post-execute callbacks and append results
    count = 0
    for name, result_text, tc_id, _ in ordered:
        if emit_callback:
            try:
                preview = result_text[:200] if isinstance(result_text, str) else str(result_text)[:200]
                emit_callback("tool_result", name, {"result": preview, "duration": 0})
            except Exception:
                pass
        messages.append(make_tool_result_message(
            name, result_text, tc_id,
            max_chars=max_result_chars,
        ))
        count += 1

    return count
