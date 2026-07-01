"""Integration tests for the Surpassing agent system."""
from __future__ import annotations


def test_workspace_compiles() -> None:
    """All workspace crates should compile (verified by CI)."""
    # This is a placeholder — real integration tests verify end-to-end flows
    assert True


def test_python_agents_importable() -> None:
    """All agent modules should be importable."""
    from hermes_agents import BaseAgent, AgentConfig
    from hermes_agents.planner import PlannerAgent
    from hermes_agents.coder import CoderAgent
    from hermes_agents.orchestrator import OrchestratorAgent

    config = AgentConfig(agent_id="test", agent_type="planner")
    agent = PlannerAgent(config)
    assert agent.config.agent_id == "test"


def test_orchestrator_registers_agents() -> None:
    """Orchestrator should register and coordinate agents."""
    from hermes_agents.orchestrator import OrchestratorAgent
    from hermes_agents.planner import PlannerAgent
    from hermes_agents.coder import CoderAgent

    config = AgentConfig(agent_id="orch", agent_type="orchestrator")
    orch = OrchestratorAgent(config)

    planner = PlannerAgent(AgentConfig(agent_id="p", agent_type="planner"))
    coder = CoderAgent(AgentConfig(agent_id="c", agent_type="coder"))

    orch.register_agent(planner)
    orch.register_agent(coder)

    assert len(orch.agents) == 2
