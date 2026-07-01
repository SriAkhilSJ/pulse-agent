"""Tests for the Planner agent."""

import asyncio
import json

import pytest

from hermes_agents.base import AgentConfig, AgentContext
from hermes_agents.planner import (
    ExecutionPlan,
    PlannerAgent,
    Subtask,
    TaskPriority,
)


def make_context(task: str = "Add user authentication", mode: str = "feature") -> AgentContext:
    return AgentContext(
        task_id="test-123",
        conversation_id="conv-456",
        code_context={"task": task, "mode": mode, "current_file": "src/main.rs"},
        memory_context={},
    )


def make_planner() -> PlannerAgent:
    config = AgentConfig(agent_id="planner-1", agent_type="planner")
    return PlannerAgent(config)


@pytest.mark.asyncio
async def test_planner_returns_success():
    planner = make_planner()
    ctx = make_context()
    result = await planner.execute(ctx)

    assert result.success is True
    assert result.agent_id == "planner-1"
    assert result.task_id == "test-123"
    assert result.confidence == 0.90


@pytest.mark.asyncio
async def test_planner_creates_execution_plan():
    planner = make_planner()
    ctx = make_context("Add user authentication", "feature")
    result = await planner.execute(ctx)

    plan_data = json.loads(result.output)
    plan = ExecutionPlan(**plan_data)

    assert plan.plan_id == "test-123"
    assert plan.original_request == "Add user authentication"
    assert len(plan.subtasks) > 0
    assert plan.analysis != ""


@pytest.mark.asyncio
async def test_planner_feature_mode_has_correct_agents():
    planner = make_planner()
    ctx = make_context("Add payment processing", "feature")
    result = await planner.execute(ctx)

    plan_data = json.loads(result.output)
    agent_types = {st["agent_type"] for st in plan_data["subtasks"]}

    assert "coder" in agent_types
    assert "tester" in agent_types
    assert "reviewer" in agent_types


@pytest.mark.asyncio
async def test_planner_bugfix_mode():
    planner = make_planner()
    ctx = make_context("Fix crash on null input", "bugfix")
    result = await planner.execute(ctx)

    plan_data = json.loads(result.output)
    plan = ExecutionPlan(**plan_data)

    assert len(plan.subtasks) >= 3
    agent_types = {st["agent_type"] for st in plan_data["subtasks"]}
    assert "debugger" in agent_types
    assert "tester" in agent_types


@pytest.mark.asyncio
async def test_planner_parallel_groups_valid():
    planner = make_planner()
    ctx = make_context("Add caching layer", "feature")
    result = await planner.execute(ctx)

    plan_data = json.loads(result.output)
    all_task_ids = {st["id"] for st in plan_data["subtasks"]}
    grouped_ids = set()

    for group in plan_data["parallel_groups"]:
        for task_id in group:
            assert task_id in all_task_ids, f"Unknown task {task_id} in parallel group"
            grouped_ids.add(task_id)

    assert grouped_ids == all_task_ids, "Not all tasks are in parallel groups"


@pytest.mark.asyncio
async def test_planner_dependencies_respect_ordering():
    planner = make_planner()
    ctx = make_context("Refactor database layer", "feature")
    result = await planner.execute(ctx)

    plan_data = json.loads(result.output)
    task_map = {st["id"]: st for st in plan_data["subtasks"]}

    # Verify no task depends on a task in a later parallel group
    group_index = {}
    for i, group in enumerate(plan_data["parallel_groups"]):
        for task_id in group:
            group_index[task_id] = i

    for st in plan_data["subtasks"]:
        for dep_id in st["dependencies"]:
            assert group_index[dep_id] <= group_index[st["id"]], (
                f"Task {st['id']} depends on {dep_id} which is in same or later group"
            )


@pytest.mark.asyncio
async def test_planner_risk_assessment_present():
    planner = make_planner()
    ctx = make_context("Add OAuth2 authentication with JWT tokens", "feature")
    result = await planner.execute(ctx)

    plan_data = json.loads(result.output)
    assert "risk_assessment" in plan_data
    assert len(plan_data["risk_assessment"]) > 0


@pytest.mark.asyncio
async def test_planner_token_estimates():
    planner = make_planner()
    ctx = make_context("Add logging", "feature")
    result = await planner.execute(ctx)

    plan_data = json.loads(result.output)
    assert plan_data["total_estimated_tokens"] > 0
    for st in plan_data["subtasks"]:
        assert st["estimated_tokens"] >= 0


@pytest.mark.asyncio
async def test_planner_health_check():
    planner = make_planner()
    assert await planner.health_check() is True


@pytest.mark.asyncio
async def test_planner_all_modes_work():
    """Verify Planner handles all supported modes without crashing."""
    planner = make_planner()

    for mode in PlannerAgent.SUPPORTED_MODES:
        ctx = make_context(f"Test {mode} task", mode)
        result = await planner.execute(ctx)
        assert result.success, f"Mode {mode} failed"
        assert result.confidence > 0

        # Verify output is valid JSON
        plan_data = json.loads(result.output)
        assert len(plan_data["subtasks"]) > 0
