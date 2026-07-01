# Surpassing IDE Agent — Vibecoding Prompt Engineering Suite

A complete prompt engineering suite for building the Surpassing IDE Agent — a next-generation, universal AI coding assistant that outperforms Cursor, GitHub Copilot, Claude Code, Windsurf, and Cline.

**Total**: 12 files, ~12,000+ lines of prompts, rules, and production-ready code scaffolding.

---

## What's Included

### 1. Hermes Master Rules (`hermes/rules`)
The system prompt that governs the Hermes Agent. Contains:
- Core architecture principles (10 non-negotiable rules)
- Vibecoding workflow (6-phase iterative cycle)
- Code quality standards (Rust/Python/TypeScript)
- Project structure convention
- Integration contracts between all 8 layers
- Agent behavior rules (Planner, Coder, Reviewer, Tester, Debugger, Orchestrator)
- LLM routing rules (privacy, complexity, cost optimization)
- Memory management rules (5-tier system)
- Security gates (auto-reject + HITL)
- Performance targets and documentation standards

### 2. Layer-by-Layer Prompt Files (`prompts/0X-*.md`)

| File | Layer | Lines | What It Builds |
|------|-------|-------|----------------|
| `00-project-scaffold.md` | Foundation | 745 | Rust workspace, Python package, TS adapters, CI/CD |
| `01-layer1-acp-protocol.md` | Universal IDE Surface | 959 | ACP protocol (JSON-RPC), VS Code client, Neovim plugin |
| `02-layer2-deep-code-understanding.md` | Semantic Understanding | 1,751 | File watcher, AST parser, Knowledge Graph, Context Assembly, Predictive Intent |
| `03-layer3-multi-agent-swarm.md` | Multi-Agent Swarm | 2,308 | Context bus, Planner, Coder, Reviewer, Tester, Debugger, Orchestrator |
| `04-layer4-llm-routing.md` | Intelligent LLM Routing | 1,119 | 3-tier router, Privacy detector, Complexity classifier, Model registry |
| `05-layer5-memory-system.md` | Persistent Memory | 1,308 | 5-tier memory: Codebase, Profile, Session, Cross-Project, Skills |
| `06-layer6-safe-execution.md` | Safe Execution | 824 | Docker sandbox, Git integration, Test validation |
| `07-layer7-security-governance.md` | Security & Governance | 942 | SAST scanner, Approval gates, Audit trail |
| `08-layer8-human-ai-collaboration.md` | Human-AI Collaboration | 1,367 | Pair programming, Learning loop, Explainability, Team sync |
| `99-workflow.md` | Vibecoding Guide | 409 | How to build it — vertical slices, daily workflow, templates |

---

## How to Use This Suite

### As a Vibecoder (Recommended)

1. **Start with `99-workflow.md`** — Read the vibecoding guide to understand the build approach
2. **Copy `hermes/rules` to your agent's rules file** — This is the master system prompt
3. **Build in vertical slices** — Follow the 8-week slice plan in the workflow guide
4. **Feed prompt files to Hermes one at a time** — Each layer prompt is self-contained and actionable

### Daily Workflow

```bash
# Morning: Pick today's slice
# Read the relevant prompt file
# Paste into Hermes with context

# Example:
# "Read prompts/01-layer1-acp-protocol.md and implement the ACP server
#  described in Steps 1-4. Follow the code quality standards in hermes/rules."

# Afternoon: Test, iterate, commit
# Evening: Document, plan tomorrow
```

### Prompt Templates (from 99-workflow.md)

- **Template 1**: Build New Component
- **Template 2**: Fix Failing Tests
- **Template 3**: Integration Wiring
- **Template 4**: Refactor

---

## Architecture Overview

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

**Key Differentiators**:
- Protocol-first (not IDE-fork) — works in VS Code, JetBrains, Zed, Vim, Emacs, Xcode
- Semantic understanding (not text RAG) — AST-level knowledge graph
- Multi-agent swarm (not single LLM call) — 6 specialists in parallel
- Predictive intent (not reactive) — anticipates next edit
- Local-first (not cloud-only) — air-gapped mode supported
- Self-improving — learns from every correction

---

## Build Milestones

| Week | Milestone | Slice |
|------|-----------|-------|
| 1 | Hello Surpassing | Agent starts, responds to chat |
| 2 | Smart Context | Chat uses knowledge graph |
| 3 | Multi-Agent Hello | Planner + Coder work together |
| 4 | Working Code | Generated code runs, tests pass |
| 5 | Smart Routing | Different tasks use different models |
| 6 | It Remembers | Memory persists across sessions |
| 7 | Safe & Secure | Security gates block dangerous ops |
| 8 | Explains Itself | Every decision is explainable |
| 12 | MVP | Full workflow: plan → code → test → review → commit |
| 24 | Enterprise | SSO, audit trails, compliance |

---

## File Structure

```
output/
├── hermes/
│   └── rules                          # Master system prompt (524 lines)
├── prompts/
│   ├── 00-project-scaffold.md         # Project setup (745 lines)
│   ├── 01-layer1-acp-protocol.md      # Universal IDE (959 lines)
│   ├── 02-layer2-deep-code-understanding.md  # Semantic graph (1751 lines)
│   ├── 03-layer3-multi-agent-swarm.md        # Agent swarm (2308 lines)
│   ├── 04-layer4-llm-routing.md             # LLM router (1119 lines)
│   ├── 05-layer5-memory-system.md           # Memory (1308 lines)
│   ├── 06-layer6-safe-execution.md          # Sandbox (824 lines)
│   ├── 07-layer7-security-governance.md     # Security (942 lines)
│   ├── 08-layer8-human-ai-collaboration.md  # Collaboration (1367 lines)
│   └── 99-workflow.md                       # Build guide (409 lines)
└── README.md                          # This file
```

---

## Tech Stack (from prompts)

| Component | Technology |
|-----------|-----------|
| Core Engine | Rust (tokio, axum, serde) |
| Agent Logic | Python 3.12+ (pydantic, httpx, anyio) |
| IDE Adapters | TypeScript (VS Code API, LSP) |
| Storage | SQLite (FTS5) + LanceDB (vectors) + Redis |
| LLM Routing | Ollama/vLLM (local) + OpenRouter (cloud) + Groq (edge) |
| Protocol | ACP (JSON-RPC 2.0 over stdio) + MCP |
| Sandbox | Docker + Firecracker microVMs + gVisor |
| Deployment | Single binary (Rust) + Python wheel + npm package |

---

## Quick Start for Vibecoders

1. Read `prompts/99-workflow.md` (the build guide)
2. Copy `hermes/rules` to your agent
3. Start with Slice 1: "Read `prompts/00-project-scaffold.md` and set up the project"
4. Ship working code every week
5. Iterate, learn, improve

---

**Build the future of coding. Surpass the competition. Amplify human potential.**
