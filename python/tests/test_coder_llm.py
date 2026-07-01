"""Test: Coder agent with real LLM via openrouter/owl-alpha."""

import asyncio
import json
import os

try:
    from dotenv import load_dotenv
    load_dotenv(r"D:\pulse\.env", override=True)
except ImportError:
    pass

import pytest

from hermes_agents.base import AgentConfig, AgentContext
from hermes_agents.coder import CoderAgent


def make_context(task: str, mode: str = "feature", existing: str = "") -> AgentContext:
    return AgentContext(
        task_id="test-coder-1",
        conversation_id="conv-1",
        code_context={
            "task": task,
            "mode": mode,
            "target_file": "src/auth.rs",
            "file_content": existing,
        },
        memory_context={},
    )


def make_coder() -> CoderAgent:
    config = AgentConfig(agent_id="coder-1", agent_type="coder")
    return CoderAgent(config)


@pytest.mark.asyncio
async def test_coder_real_llm_produces_code():
    """Verify: Coder generates code via real LLM."""
    if not os.environ.get("OPENROUTER_API_KEY"):
        pytest.skip("No OPENROUTER_API_KEY set")

    coder = make_coder()
    ctx = make_context(
        task="Add a function that validates JWT tokens",
        mode="feature",
        existing="pub fn main() {}\n",
    )
    result = await coder.execute(ctx)

    assert result.success, f"Coder failed: {result.output[:500]}"
    assert result.confidence > 0
    assert len(result.artifacts) > 0

    # Check artifacts contain code changes
    changes = result.artifacts[0].get("data", [])
    assert len(changes) >= 1, "Expected at least one code change"

    print(f"\nCoder produced {len(changes)} code change(s):")
    for i, change in enumerate(changes):
        print(f"  Change {i+1}: {change.get('file_path', 'unknown')}")
        print(f"    Explanation: {change.get('explanation', 'N/A')[:80]}")
        modified = change.get("modified", "")
        print(f"    Code ({len(modified)} chars):")
        for line in modified.split("\n")[:10]:
            print(f"      {line}")
        if len(modified.split("\n")) > 10:
            print(f"      ... ({len(modified.split(chr(10))) - 10} more lines)")


@pytest.mark.asyncio
async def test_coder_bugfix_mode():
    """Verify: Coder handles bugfix mode."""
    if not os.environ.get("OPENROUTER_API_KEY"):
        pytest.skip("No OPENROUTER_API_KEY set")

    coder = make_coder()
    ctx = make_context(
        task="Fix division by zero error",
        mode="bugfix",
        existing="fn divide(a: f64, b: f64) -> f64 { a / b }\n",
    )
    result = await coder.execute(ctx)

    assert result.success
    assert result.confidence > 0


@pytest.mark.asyncio
async def test_coder_all_modes():
    """Verify Coder handles all modes without crashing."""
    if not os.environ.get("OPENROUTER_API_KEY"):
        pytest.skip("No OPENROUTER_API_KEY set")

    coder = make_coder()
    passed = 0

    for mode in ["feature", "bugfix", "refactor", "docs", "migrate"]:
        ctx = make_context(f"Test {mode} task", mode, "// existing code\n")
        result = await coder.execute(ctx)
        assert result.success, f"Mode {mode} failed"
        if result.confidence > 0:
            passed += 1

    assert passed >= 1, f"Only {passed}/5 modes produced output"
