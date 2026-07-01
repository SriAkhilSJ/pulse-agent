"""Orchestrator agent — coordinates the multi-agent swarm."""
from __future__ import annotations

from hermes_agents.base import BaseAgent, AgentConfig, AgentContext, AgentResult
import structlog

logger = structlog.get_logger()


class OrchestratorAgent(BaseAgent):
    """Conductor agent that decomposes tasks and delegates to specialized agents."""

    def __init__(self, config: AgentConfig) -> None:
        super().__init__(config)
        self.agents: list[BaseAgent] = []

    def register_agent(self, agent: BaseAgent) -> None:
        self.agents.append(agent)

    async def execute(self, context: AgentContext) -> AgentResult:
        self.logger.info("orchestrating_task", task_id=context.task_id)
        results = []
        for agent in self.agents:
            if agent.config.enabled:
                result = await agent.execute(context)
                results.append(result)
        return AgentResult(
            agent_id=self.config.agent_id,
            task_id=context.task_id,
            success=all(r.success for r in results),
            output=f"Orchestrated {len(results)} agents",
            confidence=0.8 if results else 0.0,
        )

    async def health_check(self) -> bool:
        checks = [await a.health_check() for a in self.agents]
        return all(checks)
