# Architecture Overview

The Surpassing IDE Agent is built on an 8-layer architecture:

```
Layer 8 (Sky Blue)   Human-AI Collaboration  ← Pair programming, explainability
Layer 7 (Hot Pink)   Security & Governance   ← SAST, approval gates, audit
Layer 6 (Gold)       Safe Execution          ← Sandbox, tests, git, CI/CD
Layer 5 (Magenta)    Persistent Memory       ← 5-tier memory, skills
Layer 4 (Teal)       LLM Routing             ← Local/Edge/Cloud, privacy
Layer 3 (Neon Green) Multi-Agent Swarm       ← 6 agents in parallel
Layer 2 (Amber)      Deep Code Understanding ← Semantic knowledge graph
Layer 1 (Purple)     Universal IDE Surface   ← ACP Protocol, 7+ IDEs
```

## Key Components

- **Rust Core** (`crates/`): High-performance engine for indexing, graph, routing
- **Python Agents** (`python/`): Agent implementations, ML models, skills
- **TypeScript Adapters** (`adapters/`): IDE integrations via ACP
