# Agent Swarm

The multi-agent system consists of 6 specialized agents:

1. **Planner** — Decomposes requests into ordered subtasks
2. **Coder** — Implements features following TDD
3. **Reviewer** — Static analysis and code quality
4. **Tester** — Generates and runs tests
5. **Debugger** — Analyzes errors and suggests fixes
6. **Orchestrator** — Coordinates all agents

## Communication

Agents communicate through a shared context bus. The orchestrator manages task distribution and resolves conflicts.
