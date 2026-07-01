#!/usr/bin/env python3
"""Pulse Agent — Full conversation loop with turn lifecycle, retry state, and tool execution.

The main entry point is ``agent_loop()`` which:
  1. Builds turn context (identifiers, sanitized messages)
  2. Runs the ReAct tool-calling loop with iteration budget
  3. Finalizes the turn (trajectory save, diagnostics, result dict)

Uses the 3-tier prompt assembly from prompt_assembly.py.
"""

from __future__ import annotations

import json
import sys
import argparse
import time
import re
import logging
from pathlib import Path
from typing import Any, Optional, Callable

sys.path.insert(0, str(Path(__file__).parent))
from model_registry import load as load_registry, get_model
from llm_client import call_llm_messages
from tools import discover_tools

# New infrastructure modules
from errors import (
    PulseError, LLMError, LLMContextOverflowError, ToolNotFoundError,
    ToolExecutionError, ModelNotFoundError,
)
from error_classifier import classify_api_error, FailoverReason
from iteration_budget import IterationBudget
from turn_context import build_turn_context, TurnContext
from turn_retry_state import TurnRetryState
from turn_finalizer import finalize_turn
from tool_executor import execute_tool_calls_sequential, execute_tool_calls_concurrent
from tool_dispatch_helpers import make_tool_result_message
from tool_result_classification import truncate_tool_result
from trajectory import save_trajectory
from context_engine import ContextCompressor

logger = logging.getLogger(__name__)

_LSP_TOOL_NAME = "lspDiagnostics"


# ── Structured event emission ──────────────────────────────────────────


def _emit(event_type: str, name: str, data: dict):
    """Emit a structured JSON event to stderr for the webview."""
    msg = json.dumps({"type": event_type, "name": name, **data})
    print(msg, file=sys.stderr, flush=True)


# ── Cached system prompt ───────────────────────────────────────────────

_cached_system_prompt: str | None = None
_cached_system_prompt_args: tuple = ()


def _get_system_prompt(
    model_id: str,
    provider: str,
    workspace_path: str = "",
    platform: str | None = None,
    has_lsp: bool = False,
) -> str:
    """Build or return cached system prompt.

    Rebuilds only when arguments change (new session, different workspace).
    Caching keeps the prompt stable across turns for prefix-cache hits.
    """
    global _cached_system_prompt, _cached_system_prompt_args
    args = (model_id, provider, workspace_path, platform, has_lsp)
    if _cached_system_prompt is not None and _cached_system_prompt_args == args:
        return _cached_system_prompt

    from prompt_assembly import build_system_prompt
    _cached_system_prompt = build_system_prompt(
        model_id=model_id,
        provider=provider,
        workspace_path=workspace_path,
        platform=platform,
        has_lsp=has_lsp,
    )
    _cached_system_prompt_args = args
    preview = _cached_system_prompt[:200].replace("\n", "\\n")
    print(
        f"[Pulse] System prompt built ({len(_cached_system_prompt)} chars): {preview}...",
        file=sys.stderr, flush=True,
    )
    return _cached_system_prompt


# ── Path extraction helper ─────────────────────────────────────────────


def _extract_path(text: str) -> str | None:
    """Extract a filesystem path from user text like 'D:/pulse' or 'C:\\Users'."""
    matches = re.findall(r"[A-Za-z]:[/\\][A-Za-z0-9_\-\./\\]+", text)
    return matches[0] if matches else None


# ── Main Agent Loop ────────────────────────────────────────────────────


def agent_loop(
    user_message: str,
    workspace_path: str = "",
    max_iterations: int = 10,
    platform: str | None = None,
    *,
    model_id_override: str | None = None,
    emit_callback: Callable | None = None,
    trajectory_enabled: bool = True,
    concurrent_tools: bool = True,
) -> dict:
    """Run the Pulse Agent conversation loop with full turn lifecycle.

    Args:
        user_message: The user's input message.
        workspace_path: Project/directory path for file operations.
        max_iterations: Max ReAct iterations.
        platform: Platform hint ("cli", "ide", "api").
        model_id_override: Override model selection (e.g. "auto/fast").
        emit_callback: Optional callback for tool progress events.
        trajectory_enabled: Whether to save trajectories to JSONL.
        concurrent_tools: Allow parallel tool execution when safe.

    Returns:
        dict with response, iterations, model, provider, and metadata.
    """
    # ── Load configuration ──────────────────────────────────────────────
    reg = load_registry()
    model_id = model_id_override or "auto/fast"
    model_def = get_model(reg, model_id)
    tool_registry = discover_tools()

    has_lsp = _LSP_TOOL_NAME in tool_registry
    tool_defs = [t.to_openai_format() for t in tool_registry.values()]
    tool_names = list(tool_registry.keys())

    # ── Build system prompt (cached per session) ────────────────────────
    system_prompt = _get_system_prompt(
        model_id=model_def.id,
        provider=model_def.provider,
        workspace_path=workspace_path,
        platform=platform,
        has_lsp=has_lsp,
    )

    # ── Build turn context ──────────────────────────────────────────────
    ctx = build_turn_context(
        user_message=user_message,
        system_prompt=system_prompt,
        max_iterations=max_iterations,
    )

    _emit("progress", "start", {
        "message": f"Agent ready — model={model_def.id} provider={model_def.provider}",
        "tools": tool_names,
    })

    # ── Auto-list workspace context ─────────────────────────────────────
    target_path = _extract_path(user_message) or workspace_path or "."
    needs_auto_list = (
        workspace_path
        and any(w in user_message.lower() for w in ["folder", "directory", "project", "this", "workspace"])
    ) or (not _extract_path(user_message) and workspace_path)

    if needs_auto_list:
        list_result = tool_registry["listFiles"].execute(path=target_path)
        _emit("tool_start", "listFiles", {"path": target_path})
        _emit("tool_result", "listFiles", {"result": list_result[:500], "duration": 0})
        enriched = f"{user_message}\n\n[Auto-listed workspace: {target_path}]\n{list_result}"
        ctx.messages[ctx.current_turn_user_idx]["content"] = enriched
        ctx.user_message = enriched

    # ── Memory context injection ────────────────────────────────────────
    if memory_snapshot:
        current = ctx.messages[ctx.current_turn_user_idx]["content"]
        ctx.messages[ctx.current_turn_user_idx]["content"] = (
            f"{current}\n\n[Memory context]\n{memory_snapshot}"
        )

    # ── Iteration budget ────────────────────────────────────────────────
    budget = IterationBudget(max_iterations)
    context_compressor = ContextCompressor(context_length=200_000)

    # ── Memory initialization ──────────────────────────────────────────
    memory_mgr: Any = None
    memory_snapshot = ""
    try:
        from memory_manager import MemoryManager as _MM
        memory_mgr = _MM()
        memory_snapshot = memory_mgr.build_snapshot()
        if memory_snapshot:
            print(f"[Pulse] Memory loaded ({len(memory_snapshot)} chars)", file=sys.stderr, flush=True)
    except Exception as e:
        logger.debug("Memory init skipped: %s", e)

    # ── State for the loop ──────────────────────────────────────────────
    api_call_count = 0
    turn_exit_reason = "unknown"
    interrupted = False
    failed = False
    final_response: str | None = None

    # ── Full ReAct Loop ────────────────────────────────────────────────
    while budget.consume():
        api_call_count += 1
        retry_state = TurnRetryState()

        _emit("progress", "react", {
            "message": f"ReAct iteration {api_call_count}/{max_iterations}",
        })

        # Build messages list for this call (system + conversation)
        messages = [
            {"role": "system", "content": ctx.active_system_prompt},
            *ctx.messages,
        ]

        for _retry_attempt in range(3):  # inner retry loop
            try:
                result = call_llm_messages(
                    model=model_def.id,
                    provider=model_def.provider,
                    messages=messages,
                    tools=tool_defs,
                    tool_choice="auto",
                    max_tokens=model_def.max_output_tokens,
                )

                content = result.get("content")
                tool_calls = result.get("tool_calls")

                # ── Case 1: LLM wants to call tools ────────────────────
                if tool_calls:
                    assistant_msg: dict = {"role": "assistant", "content": content}

                    # Normalize tool_calls
                    normalized_calls = []
                    for tc in tool_calls:
                        tc_id = tc.get("id", f"call_{api_call_count}_{int(time.time() * 1000)}")
                        func = tc.get("function", tc)
                        func_name = func.get("name", "")
                        func_args_raw = func.get("arguments", "{}")
                        if isinstance(func_args_raw, str):
                            try:
                                func_args = json.loads(func_args_raw)
                            except json.JSONDecodeError:
                                func_args = {"_raw": func_args_raw}
                        else:
                            func_args = func_args_raw

                        normalized_calls.append({
                            "id": tc_id,
                            "type": "function",
                            "function": {"name": func_name, "arguments": json.dumps(func_args)},
                        })
                    assistant_msg["tool_calls"] = normalized_calls
                    ctx.messages.append(assistant_msg)

                    _emit("tool_calls", "react", {
                        "tool_calls": len(normalized_calls),
                        "iteration": api_call_count - 1,
                    })

                    # Execute tools
                    if concurrent_tools:
                        execute_tool_calls_concurrent(
                            normalized_calls, tool_registry, ctx.messages,
                            emit_callback=emit_callback,
                        )
                    else:
                        execute_tool_calls_sequential(
                            normalized_calls, tool_registry, ctx.messages,
                            emit_callback=emit_callback,
                        )

                    # Update context compressor with usage (best-effort)
                    try:
                        usage = result.get("usage", {})
                        if usage:
                            context_compressor.update_from_response(usage)
                    except Exception:
                        pass

                    # Check if we should preemptively compress
                    if context_compressor.should_compress(context_compressor.last_prompt_tokens):
                        _emit("progress", "compress", {
                            "message": "Preemptive context compression triggered",
                        })
                        compressed, new_prompt = context_compressor.compress(
                            ctx.messages, ctx.active_system_prompt,
                        )
                        if compressed != ctx.messages:
                            ctx.messages = compressed
                            ctx.active_system_prompt = new_prompt

                    break  # exit retry loop, continue outer loop

                # ── Case 2: LLM returned a final text answer ────────────
                turn_exit_reason = f"text_response(iteration={api_call_count})"
                final_response = content or ""
                ctx.messages.append({"role": "assistant", "content": final_response})
                break  # exit retry loop, will exit outer loop below

            except LLMContextOverflowError:
                # Context too long — compress and retry
                if not retry_state.restart_with_compressed_messages:
                    retry_state.restart_with_compressed_messages = True
                    compressed, new_prompt = context_compressor.compress(
                        ctx.messages, ctx.active_system_prompt,
                    )
                    ctx.messages = compressed
                    ctx.active_system_prompt = new_prompt
                    # Rebuild messages with compressed context
                    messages = [
                        {"role": "system", "content": ctx.active_system_prompt},
                        *ctx.messages,
                    ]
                    continue
                # Could not compress further — abort
                failed = True
                turn_exit_reason = "context_overflow_unrecoverable"
                final_response = "The conversation exceeded the model's context window and could not be compressed further."
                break

            except ToolNotFoundError as e:
                # Unknown tool — tell the model and let it retry
                ctx.messages.append({
                    "role": "tool",
                    "content": json.dumps({"error": str(e)}),
                    "tool_call_id": "error",
                })
                continue

            except ToolExecutionError as e:
                # Tool execution error — report and continue
                ctx.messages.append({
                    "role": "tool",
                    "content": json.dumps({"error": f"Tool execution failed: {e}"}),
                    "tool_call_id": "error",
                })
                continue

            except LLMError as e:
                # Classify the error for recovery action
                classified = classify_api_error(
                    e,
                    provider=model_def.provider,
                    model=model_def.id,
                )
                logger.warning(
                    "LLM call failed (attempt %d): %s — %s",
                    _retry_attempt + 1, classified.reason.value, classified.message,
                )

                if classified.should_compress and not retry_state.restart_with_compressed_messages:
                    retry_state.restart_with_compressed_messages = True
                    compressed, new_prompt = context_compressor.compress(
                        ctx.messages, ctx.active_system_prompt,
                    )
                    ctx.messages = compressed
                    ctx.active_system_prompt = new_prompt
                    messages = [
                        {"role": "system", "content": ctx.active_system_prompt},
                        *ctx.messages,
                    ]
                    continue

                if classified.should_fallback and not retry_state.restart_with_fallback:
                    retry_state.restart_with_fallback = True
                    # Fallback: try without tools (model may not support them)
                    if not retry_state.restart_without_tools:
                        retry_state.restart_without_tools = True
                        tool_defs = []
                        continue

                if not classified.retryable:
                    failed = True
                    turn_exit_reason = f"{classified.reason.value}"
                    final_response = (
                        f"The LLM call failed: {classified.reason.value} — "
                        f"{classified.message[:200]}"
                    )
                    break

                # Retry with backoff
                delay = 1.0 * (2 ** _retry_attempt)
                time.sleep(delay)
                continue  # inner retry loop

            except Exception as e:
                # Unexpected error — classify and retry
                logger.error("Unexpected error in agent loop: %s", e, exc_info=True)
                if _retry_attempt < 2:
                    time.sleep(1.0 * (2 ** _retry_attempt))
                    continue
                failed = True
                turn_exit_reason = f"unexpected_error({type(e).__name__})"
                final_response = f"Unexpected error: {e}"
                break

        else:
            # Inner retry loop exhausted
            if not final_response and not failed:
                failed = True
                turn_exit_reason = "retry_exhausted"
                final_response = "The LLM call failed after multiple retry attempts."

        # ── If we got a final answer OR hit an error, exit outer loop ──
        if final_response is not None or failed:
            break

    # ── Budget exhausted without final answer ──────────────────────────
    if final_response is None and not failed:
        turn_exit_reason = f"max_iterations_reached({api_call_count}/{max_iterations})"

    # ── Finalize turn ──────────────────────────────────────────────────
    result = finalize_turn(
        final_response=final_response,
        messages=ctx.messages,
        conversation_history=ctx.conversation_history,
        api_call_count=api_call_count,
        max_iterations=max_iterations,
        interrupted=interrupted,
        failed=failed,
        model=model_def.id,
        provider=model_def.provider,
        effective_task_id=ctx.effective_task_id,
        turn_id=ctx.turn_id,
        turn_exit_reason=turn_exit_reason,
        trajectory_enabled=trajectory_enabled,
    )

    # ── Post-turn memory sync ──────────────────────────────────────────
    response_text = result.get("final_response") or ""
    if memory_mgr is not None:
        try:
            memory_mgr.sync_turn(user_message, response_text, interrupted=interrupted)
        except Exception as e:
            logger.debug("Memory sync failed: %s", e)

    # ── Build user-facing response dict ────────────────────────────────
    response_text = result.get("final_response") or ""
    return {
        "type": "agent",
        "response": response_text,
        "iterations": api_call_count,
        "max_iterations": max_iterations,
        "model": model_def.id,
        "provider": model_def.provider,
        "completed": result.get("completed", False),
        "turn_exit_reason": turn_exit_reason,
        "failed": failed,
        "turn_id": ctx.turn_id,
    }


# ── CLI Entry Point ─────────────────────────────────────────────────────


def main():
    parser = argparse.ArgumentParser(description="Pulse Agent — Conversation Loop")
    parser.add_argument("--task", required=True, help="User message")
    parser.add_argument("--context", default="", help="Workspace path")
    parser.add_argument("--platform", default=None,
                        choices=["cli", "ide", "api", None],
                        help="Platform hint for system prompt")
    parser.add_argument("--max-iterations", type=int, default=10,
                        help="Max ReAct iterations")
    parser.add_argument("--no-concurrent", action="store_true",
                        help="Disable concurrent tool execution")
    args = parser.parse_args()
    try:
        result = agent_loop(
            user_message=args.task,
            workspace_path=args.context,
            max_iterations=args.max_iterations,
            platform=args.platform,
            concurrent_tools=not args.no_concurrent,
        )
        print(json.dumps(result, indent=2))
    except Exception as e:
        print(json.dumps({
            "type": "error", "error": str(e), "task": args.task,
        }), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
