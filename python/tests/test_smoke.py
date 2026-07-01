"""Smoke tests for hermes_agents."""
from __future__ import annotations

from hermes_agents.base import AgentConfig, BaseAgent


def test_agent_config_creation() -> None:
    """AgentConfig can be instantiated with required fields."""
    config = AgentConfig(agent_id="test", agent_type="planner")
    assert config.agent_id == "test"
    assert config.llm_tier == "edge"


def test_agent_config_defaults() -> None:
    """AgentConfig has sensible defaults."""
    config = AgentConfig(agent_id="test", agent_type="coder")
    assert config.max_tokens == 4096
    assert config.enabled is True
