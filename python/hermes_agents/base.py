"""Base class for all Hermes agents."""
from __future__ import annotations

import abc
from typing import Any
from pydantic import BaseModel
import structlog

logger = structlog.get_logger()


class AgentConfig(BaseModel):
    """Configuration for an agent."""
    agent_id: str
    agent_type: str
    llm_tier: str = "edge"  # local | edge | cloud
    max_tokens: int = 4096
    timeout_seconds: int = 30
    enabled: bool = True


class AgentContext(BaseModel):
    """Context passed to agents during task execution."""
    task_id: str
    conversation_id: str
    code_context: dict[str, Any]
    memory_context: dict[str, Any]
    intent_prediction: dict[str, Any] | None = None
    llm_tier: str = "edge"


class AgentResult(BaseModel):
    """Result from an agent's task execution."""
    agent_id: str
    task_id: str
    success: bool
    output: str
    artifacts: list[dict[str, Any]] = []
    tokens_used: int = 0
    latency_ms: int = 0
    confidence: float = 0.0


class BaseAgent(abc.ABC):
    """Abstract base class for all specialized agents."""

    def __init__(self, config: AgentConfig) -> None:
        self.config = config
        self.logger = logger.bind(agent_id=config.agent_id, agent_type=config.agent_type)

    @abc.abstractmethod
    async def execute(self, context: AgentContext) -> AgentResult:
        """Execute the agent's specialized task."""
        ...

    @abc.abstractmethod
    async def health_check(self) -> bool:
        """Return True if the agent is healthy and ready."""
        ...

    async def pre_execute(self, context: AgentContext) -> AgentContext:
        """Hook called before execute. Override to modify context."""
        return context

    async def post_execute(self, result: AgentResult) -> AgentResult:
        """Hook called after execute. Override to process result."""
        return result
