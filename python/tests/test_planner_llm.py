"""Test: Planner with REAL LLM produces dynamic subtasks."""

import asyncio
import json
import os

# Load .env before anything else
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

import pytest

from hermes_agents.base import AgentConfig, AgentContext
from hermes_agents.planner import PlannerAgent


def make_context(task: str, mode: str = "feature") -> AgentContext:
    return AgentContext(
        task_id="test-llm-1",
        conversation_id="conv-1",
        code_context={"task": task, "mode": mode, "current_file": "src/main.rs"},
        memory_context={},
    )


def make_planner() -> PlannerAgent:
    config = AgentConfig(agent_id="planner-1", agent_type="planner")
    return PlannerAgent(config)


@pytest.mark.asyncio
async def test_planner_real_llm_produces_subtasks():
    """Verify: 'Add auth' produces a plan with multiple subtasks via real LLM."""
    # Skip if no API key available
    if not os.environ.get("GROQ_API_KEY"):
        pytest.skip("No GROQ_API_KEY set")

    planner = make_planner()
    ctx = make_context("Add user authentication with JWT tokens", "feature")
    result = await planner.execute(ctx)

    assert result.success, f"Planner failed: {result.output[:500]}"

    plan_data = json.loads(result.output)
    assert "subtasks" in plan_data
    assert len(plan_data["subtasks"]) >= 3, f"Expected 3+ subtasks, got {len(plan_data['subtasks'])}"

    # Verify subtask structure
    for st in plan_data["subtasks"]:
        assert "id" in st
        assert "description" in st
        assert "agent_type" in st
        assert st["agent_type"] in ("coder", "tester", "reviewer", "debugger", "planner")

    # Verify parallel groups exist
    assert len(plan_data["parallel_groups"]) > 0

    # Print for visibility
    print(f"\nReal LLM produced {len(plan_data['subtasks'])} subtasks:")
    for st in plan_data["subtasks"]:
        print(f"  {st['id']} | {st['agent_type']:10} deps={st['dependencies']} | {st['description']}")
    print(f"Parallel groups: {plan_data['parallel_groups']}")
