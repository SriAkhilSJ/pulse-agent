"""
Pulse Agent — System Prompt Assembly (3-Tier Architecture).

Assembles the system prompt from three tiers:
  - Stable: identity, guidance blocks, environment hints, platform hints
  - Context: caller-supplied system_message + project context files
  - Volatile: workspace info, model/provider, timestamp

Tiers are joined with double-newlines. Call build_system_prompt() once per
session and cache the result for prefix-cache efficiency.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Optional

from prompt_blocks import (
    DEFAULT_AGENT_IDENTITY,
    TASK_COMPLETION_GUIDANCE,
    TOOL_USE_ENFORCEMENT_GUIDANCE,
    TOOL_USE_ENFORCEMENT_MODELS,
    PARALLEL_TOOL_CALL_GUIDANCE,
    OPENAI_MODEL_EXECUTION_GUIDANCE,
    GOOGLE_MODEL_OPERATIONAL_GUIDANCE,
    SKILLS_GUIDANCE,
    LSP_GUIDANCE,
    build_environment_hints,
    build_python_toolchain_hint,
    resolve_platform_hint,
)

# ═══════════════════════════════════════════════════════════════════════════════
# Context File Discovery
# ═══════════════════════════════════════════════════════════════════════════════

_CONTEXT_FILE_NAMES = (
    "AGENTS.md", "CLAUDE.md", ".cursorrules",
    ".pulse.md", "PULSE.md",
)


def _find_git_root(start: Path) -> Optional[Path]:
    """Walk *start* and its parents looking for a .git directory."""
    current = start.resolve()
    for parent in [current] + list(current.parents):
        if (parent / ".git").exists():
            return parent
    return None


def _discover_context_files(workspace_path: str) -> list[tuple[str, str]]:
    """Discover context files (AGENTS.md, CLAUDE.md, etc.) near the workspace.

    Returns list of (filename, content) tuples.
    """
    if not workspace_path:
        return []
    start = Path(workspace_path).resolve()
    stop_at = _find_git_root(start)
    results = []

    # Check workspace dir and parents up to git root
    current = start
    for _ in range(10):  # safety limit
        for name in _CONTEXT_FILE_NAMES:
            candidate = current / name
            if candidate.is_file():
                content = candidate.read_text(encoding="utf-8", errors="replace")
                content = _sanitize_context_content(content, name)
                results.append((name, content))
        if stop_at and current == stop_at:
            break
        if current.parent == current:
            break
        current = current.parent

    return results


def _sanitize_context_content(content: str, filename: str) -> str:
    """Simple injection defense for context files.

    Scans for known prompt injection patterns. If found, blocks content.
    """
    danger_patterns = [
        "ignore previous instructions",
        "ignore all previous",
        "you are now",
        "system prompt:",
        "forget everything",
        "override your instructions",
    ]
    lower = content.lower()
    for pattern in danger_patterns:
        if pattern in lower:
            return (
                f"[BLOCKED: {filename} contained potential prompt injection "
                f"pattern '{pattern}'. Content not loaded.]"
            )
    return content


# ═══════════════════════════════════════════════════════════════════════════════
# Model Detection
# ═══════════════════════════════════════════════════════════════════════════════

def _model_family_lower(model_id: str) -> str:
    """Return the model id lowercased for pattern matching."""
    return (model_id or "").lower()


def _needs_tool_enforcement(model_id: str) -> bool:
    """Check if this model family needs tool-use enforcement guidance."""
    lower = _model_family_lower(model_id)
    return any(p in lower for p in TOOL_USE_ENFORCEMENT_MODELS)


def _is_google_model(model_id: str) -> bool:
    """Check if this is a Google model family."""
    lower = _model_family_lower(model_id)
    return "gemini" in lower or "gemma" in lower


def _is_openai_model(model_id: str) -> bool:
    """Check if this is an OpenAI/GPT model family."""
    lower = _model_family_lower(model_id)
    return "gpt" in lower or "codex" in lower or "grok" in lower


# ═══════════════════════════════════════════════════════════════════════════════
# Prompt Assembly
# ═══════════════════════════════════════════════════════════════════════════════

def build_system_prompt_parts(
    model_id: str,
    provider: str,
    workspace_path: str = "",
    system_message: Optional[str] = None,
    platform: Optional[str] = None,
    has_lsp: bool = False,
) -> dict[str, str]:
    """Assemble the system prompt as three ordered parts.

    Returns a dict with keys: stable, context, volatile.
    Joined by build_system_prompt().
    """
    # ── Stable tier ──────────────────────────────────────────────────────
    stable_parts: list[str] = []

    # Identity
    stable_parts.append(DEFAULT_AGENT_IDENTITY)

    # Task completion guidance (always on)
    stable_parts.append(TASK_COMPLETION_GUIDANCE)

    # Parallel tool call guidance
    stable_parts.append(PARALLEL_TOOL_CALL_GUIDANCE)

    # Tool-use enforcement (model-gated)
    if _needs_tool_enforcement(model_id):
        stable_parts.append(TOOL_USE_ENFORCEMENT_GUIDANCE)
        # Model-specific subsections
        if _is_google_model(model_id):
            stable_parts.append(GOOGLE_MODEL_OPERATIONAL_GUIDANCE)
        if _is_openai_model(model_id):
            stable_parts.append(OPENAI_MODEL_EXECUTION_GUIDANCE)

    # Environment hints
    env_hints = build_environment_hints()
    if env_hints:
        stable_parts.append(env_hints)

    # Python toolchain probe
    py_hint = build_python_toolchain_hint()
    if py_hint:
        stable_parts.append(py_hint)

    # Platform hint
    plat_hint = resolve_platform_hint(platform)
    if plat_hint:
        stable_parts.append(plat_hint)

    # LSP diagnostics guidance (when lspDiagnostics tool is available)
    if has_lsp:
        stable_parts.append(LSP_GUIDANCE)

    # Skills guidance (always on)
    stable_parts.append(SKILLS_GUIDANCE)

    # ── Context tier ─────────────────────────────────────────────────────
    context_parts: list[str] = []

    # Caller-supplied system message
    if system_message:
        context_parts.append(system_message)

    # Context files from workspace
    context_files = _discover_context_files(workspace_path)
    for fname, fcontent in context_files:
        if fcontent.strip():
            context_parts.append(f"[Context file: {fname}]\n{fcontent.strip()}")

    # ── Volatile tier ────────────────────────────────────────────────────
    volatile_parts: list[str] = []

    # Workspace info
    if workspace_path:
        volatile_parts.append(f"Workspace: {workspace_path}")

    # Model/provider info
    if model_id:
        volatile_parts.append(f"Model: {model_id}")
    if provider:
        volatile_parts.append(f"Provider: {provider}")

    # Timestamp (date-only for cache stability)
    from datetime import datetime
    volatile_parts.append(
        f"Session started: {datetime.now().strftime('%A, %B %d, %Y')}"
    )

    return {
        "stable": "\n\n".join(p.strip() for p in stable_parts if p and p.strip()),
        "context": "\n\n".join(p.strip() for p in context_parts if p and p.strip()),
        "volatile": "\n\n".join(p.strip() for p in volatile_parts if p and p.strip()),
    }


def build_system_prompt(
    model_id: str,
    provider: str,
    workspace_path: str = "",
    system_message: Optional[str] = None,
    platform: Optional[str] = None,
    has_lsp: bool = False,
) -> str:
    """Assemble the full system prompt from all three tiers.

    Call this once per session and cache the result.
    Tiers are ordered: stable (cache-friendly) -> context -> volatile.
    """
    parts = build_system_prompt_parts(
        model_id=model_id,
        provider=provider,
        workspace_path=workspace_path,
        system_message=system_message,
        platform=platform,
        has_lsp=has_lsp,
    )
    joined = "\n\n".join(
        p for p in (parts["stable"], parts["context"], parts["volatile"]) if p
    )
    return joined
