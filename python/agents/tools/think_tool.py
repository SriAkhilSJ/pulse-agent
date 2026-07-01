"""
Pulse Agent — thinkTool.

A no-op tool that lets the model reason step-by-step before taking action.
The tool simply echoes the thought back — its purpose is to give the model
a structured way to plan without executing side effects.

Design:
- Pure reasoning tool — no state changes, no side effects
- Returns the thought content unchanged
- Gives the model space to decompose complex tasks
"""

from __future__ import annotations

import json
import logging

logger = logging.getLogger(__name__)

name = "thinkTool"
description = "A safe no-op tool for step-by-step reasoning. Use this to think through a problem, plan your approach, or decompose a complex task before executing tools. The tool simply echoes your thoughts back — no side effects."
category = "utility"
danger_level = "safe"
keywords = ("think", "reason", "plan", "decompose", "analyze", "strategy")

parameters = {
    "type": "object",
    "properties": {
        "thought": {
            "type": "string",
            "description": "Your step-by-step reasoning. Break down the problem, list what you know and what you need to find out, then plan the tools you'll call.",
        },
    },
    "required": ["thought"],
}


def run(thought: str) -> str:
    """Process a thought (no-op). Returns the thought for context."""
    return json.dumps({
        "thought": thought,
        "length": len(thought),
        "hint": "Continue with your planned tool calls.",
    })
