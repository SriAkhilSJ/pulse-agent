"""Post-loop turn finalization — budget-exhaustion summary, trajectory save, result dict.

Called once per turn after the main tool-calling loop exits.  Handles:
- Budget-exhaustion summary (one extra LLM call with tools stripped)
- Trajectory persistence
- Result dict assembly with token usage, model info, and completion status
"""

from __future__ import annotations

import json
import logging
from typing import Any, Optional

from trajectory import save_trajectory

logger = logging.getLogger(__name__)


def finalize_turn(
    *,
    final_response: Optional[str],
    messages: list[dict[str, Any]],
    conversation_history: Optional[list[dict[str, Any]]],
    api_call_count: int,
    max_iterations: int,
    interrupted: bool,
    failed: bool,
    model: str,
    provider: str,
    effective_task_id: str,
    turn_id: str,
    turn_exit_reason: str,
    trajectory_enabled: bool = True,
    # LLM client for budget-exhaustion summary call
    call_llm_fn=None,
) -> dict[str, Any]:
    """Run post-loop finalization and return the turn result dict.

    Args:
        final_response: The LLM's final text response (may be None if exhausted).
        messages: Full turn message list.
        conversation_history: Prior turn messages.
        api_call_count: Number of API calls made this turn.
        max_iterations: Maximum allowed API calls.
        interrupted: Whether the turn was interrupted by the user.
        failed: Whether the turn ended in an unrecoverable error.
        model: Model identifier.
        provider: Provider name.
        effective_task_id: Unique task ID for tracing.
        turn_id: Unique turn ID.
        turn_exit_reason: Machine-readable exit reason string.
        trajectory_enabled: Whether to save trajectory.
        call_llm_fn: Optional callable for budget-exhaustion summary.

    Returns:
        Result dict with response, metadata, and completion status.
    """
    # ── Budget exhaustion: ask model to summarise ────────────────────
    if final_response is None and (
        api_call_count >= max_iterations
    ):
        turn_exit_reason = f"max_iterations_reached({api_call_count}/{max_iterations})"
        logger.info(
            "Iteration budget exhausted (%d/%d) — requesting summary",
            api_call_count, max_iterations,
        )
        if call_llm_fn is not None:
            final_response = _request_summary(call_llm_fn, messages)

    # ── Determine completion status ──────────────────────────────────
    normal_text_response = str(turn_exit_reason or "").startswith("text_response(")
    completed = (
        final_response is not None
        and not failed
        and (
            api_call_count < max_iterations
            or normal_text_response
        )
    )

    # ── Save trajectory ──────────────────────────────────────────────
    if trajectory_enabled and messages:
        try:
            save_trajectory(messages, model, provider, completed)
        except Exception as e:
            logger.warning("trajectory save failed: %s", e)

    # ── Turn-exit diagnostics ────────────────────────────────────────
    last_role = messages[-1].get("role") if messages else None
    tool_turns = sum(
        1 for m in messages
        if isinstance(m, dict) and m.get("role") == "assistant" and m.get("tool_calls")
    )
    resp_len = len(final_response) if final_response else 0

    logger.info(
        "Turn ended: reason=%s api_calls=%d/%d tool_turns=%d last=%s response_len=%d",
        turn_exit_reason, api_call_count, max_iterations,
        tool_turns, last_role, resp_len,
    )

    # ── Build result dict ────────────────────────────────────────────
    result: dict[str, Any] = {
        "final_response": final_response,
        "messages": messages,
        "api_calls": api_call_count,
        "completed": completed,
        "turn_exit_reason": turn_exit_reason,
        "failed": failed,
        "interrupted": interrupted,
        "model": model,
        "provider": provider,
        "turn_id": turn_id,
        "task_id": effective_task_id,
    }

    return result


def _request_summary(
    call_llm_fn,
    messages: list[dict[str, Any]],
) -> str:
    """Make one extra toolless LLM call asking for a summary."""
    try:
        # Find the system prompt
        system = next((m["content"] for m in messages if m.get("role") == "system"), "")
        summary_prompt = (
            "The task could not be completed within the available iterations. "
            "Provide a brief summary of progress made and what remains to be done."
        )
        result = call_llm_fn(
            system_prompt=system,
            user_message=summary_prompt,
        )
        return result if isinstance(result, str) else str(result)
    except Exception as e:
        logger.warning("Summary request failed: %s", e)
        return "Task could not be completed within the available iterations."
