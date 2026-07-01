"""Turn context — captures all values produced by the once-per-turn prologue.

The main agent loop calls ``build_turn_context()`` before entering the tool-calling
loop. It returns a ``TurnContext`` dataclass carrying everything the loop consumes:
sanitized messages, cached system prompt, task identifiers, and prefetched context.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass, field
from typing import Any, Optional

logger = logging.getLogger(__name__)


@dataclass
class TurnContext:
    """Values produced by the turn prologue and consumed by the tool-calling loop."""

    # Sanitized user message for this turn.
    user_message: str
    # Original user message (preserved for logging / memory queries, no injected context).
    original_user_message: str
    # Working message list (loop appends assistant+tool messages to it).
    messages: list[dict[str, Any]]
    # Conversation history from prior turns (may be None on first turn).
    conversation_history: Optional[list[dict[str, Any]]]
    # Cached system prompt active for this turn (may be rebuilt by compression).
    active_system_prompt: str
    # Unique task identifier for resource isolation.
    effective_task_id: str
    # Unique turn identifier for tracing.
    turn_id: str
    # Index of the current user turn within messages.
    current_turn_user_idx: int
    # Whether the post-turn memory review should fire (not used in basic mode).
    should_review_memory: bool = False


def build_turn_context(
    user_message: str,
    *,
    conversation_history: Optional[list[dict[str, Any]]] = None,
    system_prompt: str = "",
    max_iterations: int = 10,
) -> TurnContext:
    """Run the once-per-turn setup and return the loop's input context.

    Args:
        user_message: The user's raw input message.
        conversation_history: Messages from prior turns (may be None).
        system_prompt: The assembled system prompt (stable + context + volatile).
        max_iterations: Maximum ReAct iterations (for budget setup).

    Returns:
        TurnContext with sanitized message, identifiers, and working state.
    """
    # Generate unique task/turn IDs
    effective_task_id = str(uuid.uuid4())
    turn_id = f"turn:{effective_task_id}:{uuid.uuid4().hex[:8]}"

    # Initialize working message list
    messages = list(conversation_history) if conversation_history else []

    # Log turn start
    preview = (user_message[:80] + "...") if len(user_message) > 80 else user_message
    preview = preview.replace("\n", " ")
    logger.info(
        "Turn start: history=%d model=%s msg=%r",
        len(conversation_history or []), "-", preview,
    )

    # Add user message
    user_msg: dict[str, Any] = {"role": "user", "content": user_message}
    messages.append(user_msg)
    current_turn_user_idx = len(messages) - 1

    # Preserve original for memory queries
    original_user_message = user_message

    return TurnContext(
        user_message=user_message,
        original_user_message=original_user_message,
        messages=messages,
        conversation_history=conversation_history,
        active_system_prompt=system_prompt,
        effective_task_id=effective_task_id,
        turn_id=turn_id,
        current_turn_user_idx=current_turn_user_idx,
        should_review_memory=False,
    )
