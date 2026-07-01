"""Trajectory saving — log conversation traces to JSONL files for debugging and analysis."""

from __future__ import annotations

import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)


def save_trajectory(
    messages: list[dict[str, Any]],
    model: str,
    provider: str,
    completed: bool,
    trajectory_dir: Optional[str] = None,
) -> Optional[str]:
    """Append a trajectory entry to a JSONL file.

    Args:
        messages: Full message list (system + user + assistant + tool).
        model: Model name.
        provider: Provider name.
        completed: Whether the conversation completed with a final answer.
        trajectory_dir: Override output directory. Defaults to
                        ``~/.pulse/trajectories/``.

    Returns:
        Path to the written file, or None on failure.
    """
    if trajectory_dir:
        out_dir = Path(trajectory_dir)
    else:
        out_dir = Path.home() / ".pulse" / "trajectories"
    out_dir.mkdir(parents=True, exist_ok=True)

    filename = "trajectory_samples.jsonl" if completed else "failed_trajectories.jsonl"
    out_path = out_dir / filename

    # Strip image blobs from trajectory for space
    clean_messages = _strip_images(messages)

    entry = {
        "conversations": clean_messages,
        "timestamp": datetime.now().isoformat(),
        "model": model,
        "provider": provider,
        "completed": completed,
    }

    try:
        with open(out_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
        logger.info("Trajectory saved to %s (%d messages)", out_path, len(messages))
        return str(out_path)
    except Exception as e:
        logger.warning("Failed to save trajectory: %s", e)
        return None


def _strip_images(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Strip image content from messages for compact trajectory storage."""
    cleaned = []
    for msg in messages:
        msg = dict(msg)  # shallow copy
        content = msg.get("content")
        if isinstance(content, list):
            # Content parts list — replace image parts with placeholder
            stripped = []
            for part in content:
                if isinstance(part, dict) and part.get("type") in ("image", "image_url", "input_image"):
                    stripped.append({"type": "text", "text": "[image]"})
                else:
                    stripped.append(part)
            msg["content"] = stripped
        elif isinstance(content, dict) and content.get("_multimodal"):
            # Multimodal envelope — use text_summary if available
            msg["content"] = content.get("text_summary") or "[multimodal result]"
        cleaned.append(msg)
    return cleaned
