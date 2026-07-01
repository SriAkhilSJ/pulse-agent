"""Planner agent — breaks tasks into ordered, dependent subtasks.

The Planner is the strategist. It:
1. Analyzes the request and codebase context
2. Decomposes into subtasks with dependencies via REAL LLM
3. Identifies risks and proposes rollback strategies
4. Estimates token costs and suggests LLM tier per subtask
5. Outputs a structured plan, not free text
"""

from __future__ import annotations

import json
import logging
import os
import re
import structlog
import sys
import uuid
from enum import Enum
from typing import Any, Optional

structlog.configure(
    wrapper_class=structlog.make_filtering_bound_logger(logging.WARNING),
    logger_factory=structlog.PrintLoggerFactory(file=sys.stderr),
)
from pydantic import BaseModel, Field

from hermes_agents.base import AgentConfig, AgentContext, AgentResult, BaseAgent

logger = structlog.get_logger()


class TaskPriority(str, Enum):
    CRITICAL = "critical"
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class TaskStatus(str, Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "failed"
    BLOCKED = "blocked"
    SKIPPED = "skipped"


class Subtask(BaseModel):
    """A single subtask in the plan."""
    id: str
    description: str
    agent_type: str
    priority: TaskPriority = TaskPriority.MEDIUM
    status: TaskStatus = TaskStatus.PENDING
    dependencies: list[str] = Field(default_factory=list)
    estimated_tokens: int = 0
    suggested_llm_tier: str = "edge"
    estimated_duration_seconds: int = 30
    rollback_action: str = ""
    accept_criteria: list[str] = Field(default_factory=list)
    artifacts: list[str] = Field(default_factory=list)


class ExecutionPlan(BaseModel):
    """A complete execution plan."""
    plan_id: str
    original_request: str
    analysis: str
    subtasks: list[Subtask]
    risk_assessment: str
    total_estimated_tokens: int = 0
    total_estimated_duration_seconds: int = 0
    parallel_groups: list[list[str]] = Field(default_factory=list)


class PlannerAgent(BaseAgent):
    """Planner — decomposes tasks into executable subtasks using real LLM."""

    SUPPORTED_MODES = [
        "feature", "bugfix", "refactor", "test", "docs", "migrate", "review", "explore",
    ]

    def __init__(self, config: AgentConfig) -> None:
        super().__init__(config)
        self._llm = None

    @property
    def llm(self):
        """Lazy-init LLM client."""
        if self._llm is None:
            from hermes_ml.llm_client import LLMClient
            self._llm = LLMClient()
        return self._llm

    async def execute(self, context: AgentContext) -> AgentResult:
        """Create an execution plan for the given task using real LLM."""
        task = context.code_context.get("task", "")
        mode = context.code_context.get("mode", "feature")

        logger.info("planner_start", task=task[:100], mode=mode)

        # Step 1: Analyze the request
        analysis = self._analyze_request(task, mode, context)

        # Step 2: Decompose into subtasks via LLM
        subtasks = await self._decompose_with_llm(task, mode, analysis, context)

        # Step 3: Add dependencies and ordering
        subtasks = self._add_dependencies(subtasks)

        # Step 4: Risk assessment
        risks = self._assess_risks(subtasks)

        # Step 5: Calculate parallel groups
        parallel_groups = self._calculate_parallel_groups(subtasks)

        # Step 6: Build plan
        plan = ExecutionPlan(
            plan_id=context.task_id,
            original_request=task,
            analysis=analysis,
            subtasks=subtasks,
            risk_assessment=risks,
            total_estimated_tokens=sum(st.estimated_tokens for st in subtasks),
            total_estimated_duration_seconds=sum(st.estimated_duration_seconds for st in subtasks),
            parallel_groups=parallel_groups,
        )

        return AgentResult(
            agent_id=self.config.agent_id,
            task_id=context.task_id,
            success=True,
            output=json.dumps(plan.model_dump(), indent=2),
            artifacts=[{"type": "execution_plan", "data": plan.model_dump()}],
            confidence=0.90,
        )

    def _analyze_request(self, task: str, mode: str, context: AgentContext) -> str:
        """Analyze what the user is asking for."""
        current_file = context.code_context.get("current_file", "unknown")
        project_type = context.code_context.get("project_type", "unknown")
        key_terms = self._extract_key_terms(task)

        parts = [
            f"Task: {task}",
            f"Mode: {mode}",
            f"Current file: {current_file}",
            f"Project type: {project_type}",
        ]
        if key_terms:
            parts.append(f"Key terms: {', '.join(key_terms)}")
        return "\n".join(parts)

    def _extract_key_terms(self, task: str) -> list[str]:
        """Extract key technical terms from the task."""
        terms = []
        terms.extend(re.findall(r'"([^"]+)"', task))
        terms.extend(re.findall(r"'([^']+)'", task))
        terms.extend(re.findall(r'\b[A-Z][a-zA-Z0-9]{2,}\b', task))
        terms.extend(re.findall(r'\b[a-z][a-z0-9]*_[a-z0-9_]+\b', task))
        return list(set(terms))[:10]

    async def _decompose_with_llm(self, task: str, mode: str, analysis: str, context: AgentContext) -> list[Subtask]:
        """Use real LLM to decompose the task into subtasks with project context."""

        system_prompt = """You are the Planner agent in the Surpassing IDE Agent — a next-generation AI coding assistant.
Your job is to decompose coding tasks into specific, actionable subtasks.

PROJECT CONTEXT:
{project_context}

ARCHITECTURE:
- Rust workspace with 9 crates: core, graph, acp, indexer, orchestrator, router, memory, sandbox, security
- Each crate is a separate Rust library in crates/<name>/src/
- Communication: ACP (JSON-RPC over stdio) between IDE and agent process
- Python agents (planner, coder) are called from Rust via subprocess

Each subtask must have:
- id: T1, T2, T3, etc.
- description: one clear sentence
- agent_type: coder, tester, reviewer, debugger, or planner
- dependencies: list of subtask IDs that must complete first (empty if none)
- estimated_tokens: rough token count (100-2000)
- estimated_duration_seconds: rough time estimate (10-120)
- suggested_llm_tier: local (simple), edge (standard), or cloud (complex)

Output ONLY a JSON array of subtasks. No markdown, no explanation."""

        project_ctx = context.code_context.get("project_context_summary", "")
        prompt = system_prompt.format(project_context=project_ctx)

        user_prompt = f"""Decompose this coding task:

Task: {task}
Mode: {mode}
Context: {analysis}

Existing modules: {', '.join(context.code_context.get('project_modules', []))}

Output JSON array:"""

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]

        try:
            response = self.llm.chat_with_retries(messages=messages, max_tokens=2048, temperature=0.3)
            content = response["choices"][0]["message"]["content"]

            # Extract JSON from response
            json_match = re.search(r'\[.*\]', content, re.DOTALL)
            if json_match:
                raw_subtasks = json.loads(json_match.group())
                return [Subtask(**st) for st in raw_subtasks]

        except Exception as e:
            logger.warning("llm_decompose_failed", error=str(e)[:200])

        # Fallback: return a simple single-task plan
        return [Subtask(
            id="T1",
            description=f"Implement: {task}",
            agent_type="coder",
            estimated_tokens=1000,
            estimated_duration_seconds=60,
        )]

    def _add_dependencies(self, subtasks: list[Subtask]) -> list[Subtask]:
        """Validate dependencies, remove cycles."""
        ids = {st.id for st in subtasks}
        for st in subtasks:
            st.dependencies = [d for d in st.dependencies if d in ids]

        # Break cycles
        visited = set()
        temp_mark = set()

        def has_cycle(task_id: str) -> bool:
            if task_id in temp_mark:
                return True
            if task_id in visited:
                return False
            temp_mark.add(task_id)
            task = next((t for t in subtasks if t.id == task_id), None)
            if task:
                for dep in task.dependencies:
                    if has_cycle(dep):
                        return True
            temp_mark.discard(task_id)
            visited.add(task_id)
            return False

        for st in subtasks:
            if has_cycle(st.id):
                logger.warning("dependency_cycle_detected", task_id=st.id)
                st.dependencies = st.dependencies[:-1]

        return subtasks

    def _assess_risks(self, subtasks: list[Subtask]) -> str:
        """Assess risks for the plan."""
        risks = []
        file_changes = sum(1 for st in subtasks if st.agent_type == "coder")
        if file_changes > 5:
            risks.append(f"High: {file_changes} coding tasks — high blast radius")
        has_tests = any(st.agent_type == "tester" for st in subtasks)
        if not has_tests and file_changes > 2:
            risks.append("Medium: No test generation planned")
        total_tokens = sum(st.estimated_tokens for st in subtasks)
        if total_tokens > 5000:
            risks.append(f"High: ~{total_tokens} tokens estimated")
        return "\n".join(risks) if risks else "Low risk — standard workflow"

    def _calculate_parallel_groups(self, subtasks: list[Subtask]) -> list[list[str]]:
        """Group subtasks that can run in parallel."""
        remaining = {st.id for st in subtasks}
        groups = []

        while remaining:
            group = []
            for task_id in remaining:
                task = next(st for st in subtasks if st.id == task_id)
                deps_satisfied = all(d not in remaining for d in task.dependencies)
                if deps_satisfied:
                    group.append(task_id)

            if not group:
                group = [remaining.pop()]
            else:
                for tid in group:
                    remaining.discard(tid)
            groups.append(group)

        return groups

    async def health_check(self) -> bool:
        return True
