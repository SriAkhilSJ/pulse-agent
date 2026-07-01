#!/usr/bin/env python3
"""Pulse Agent — Pipeline: classifies task, routes to direct LLM or agent_loop."""

from __future__ import annotations

import json
import sys
import argparse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from llm_client import call_llm
from model_registry import load as load_registry, get_model

# ── Classifier ──────────────────────────────────────────────────────────

_QUESTION_INDICATORS = [
    "what is", "what's", "how do", "how to", "why is",
    "explain", "describe", "tell me", "define",
    "difference between", "vs ", "versus",
]

_TOOL_KEYWORDS = [
    "analyze", "list ", "show me", "what's in", "what is in",
    "explore", "inspect", "check", "look at",
    "read ", "open ", "find ", "search for",
    "run ", "execute", "terminal", "command",
    "folder", "directory", "file", "files",
    "todo", "to-do", "task", "tasks",
    "create", "implement", "write", "build", "make", "generate",
    "fix ", "refactor", "update", "modify",
]


def classify(task: str) -> str:
    """Classify task: 'chat' or 'tool'. Chat = question answering. Tool = needs agent loop."""
    lower = task.lower()
    q_score = sum(1 for q in _QUESTION_INDICATORS if lower.startswith(q))
    t_score = sum(1 for k in _TOOL_KEYWORDS if k in lower)

    if t_score >= 2 or any(k in lower for k in [
        "analyze", "what's in", "what is in", "list files", "show me the",
        "create ", "implement ", "write a", "build ",
    ]):
        return "tool"
    if q_score > 0 and t_score == 0:
        return "chat"
    if t_score > 0:
        return "tool"
    # Default: pure questions go to chat, anything with action intent to tool
    return "chat"


# ── Direct Chat ─────────────────────────────────────────────────────────

def direct_answer(task: str) -> dict:
    """Simple Q&A — one LLM call, no tools."""
    reg = load_registry()
    model_def = get_model(reg, "openrouter/free")
    user_msg = f"Answer the following concisely and helpfully:\n\n{task}"
    result_text = call_llm(
        model=model_def.id,
        provider=model_def.provider,
        system_prompt="You are Pulse Code AI, a helpful coding assistant. Answer concisely.",
        user_message=user_msg,
        max_tokens=model_def.max_output_tokens,
    )
    return {"task": task, "type": "chat", "response": result_text, "_model": model_def.id}


# ── Main Entry Point ────────────────────────────────────────────────────

def run(task: str, project_context: str = "", platform: str | None = None) -> dict:
    """Classify and route.

    Args:
        task: User input message
        project_context: Workspace/project path
        platform: Platform hint ("cli", "ide", "api") for prompt assembly
    """
    mode = classify(task)
    print(json.dumps({"type": "progress", "message": f"Classified as: {mode}"}), file=sys.stderr, flush=True)
    if mode == "tool":
        from agent_loop import agent_loop
        return agent_loop(task, project_context, platform=platform)
    return direct_answer(task)


def main():
    parser = argparse.ArgumentParser(description="Pulse Agent — Pipeline")
    parser.add_argument("--task", required=True, help="User message")
    parser.add_argument("--context", default="", help="Workspace path")
    parser.add_argument("--platform", default=None, choices=["cli", "ide", "api"], help="Platform hint for prompt assembly")
    args = parser.parse_args()
    try:
        result = run(args.task, args.context, platform=args.platform)
        print(json.dumps(result, indent=2))
    except Exception as e:
        print(json.dumps({"type": "error", "error": str(e), "task": args.task}), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
