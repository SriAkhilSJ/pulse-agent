# PulseCodeAI IDE Agent — Architecture & Roadmap

> **Product**: Multi-agent AI coding assistant (closed-source, profitable startup)
> **IDE Name**: PulseCodeAI IDE (VS Code OSS fork)
> **Agent Name**: Pulse Agent
> **Stack**: Python 3.11 agents + TypeScript VS Code extension + Rust ACP server

---

## Architecture Overview

```
User (IDE Chat / Webview)
        │
        ▼
┌──────────────────┐
│  VS Code Extension │  ← D:\pulse\adapters\vscode
│  (TypeScript)      │     - Chat panel (webview)
│  (src/extension.ts)│     - Pulse: Open Chat Panel
│  (src/chat-panel.ts)│    - Pulse: Run Agent Pipeline
└──────┬───────────┘
       │ spawns
       ▼
┌──────────────────┐
│    Pipeline       │  ← D:\pulse\python\agents\pipeline.py
│    (Python 3.11)  │     Classifies: chat vs tool
└──────┬───────────┘
       │ routes to
       ▼
┌─────────────────────────────────┐
│      ReAct Agent Loop           │  ← D:\pulse\python\agents\agent_loop.py
│  (LLM + tools, iterative)       │
│                                 │
│  Tools: listFiles, readFile,    │
│         runCommand, applyEdit,  │
│         todo                    │
└─────────────────────────────────┘
       │
       ▼
┌──────────────────┐
│  Model Registry   │  ← D:\pulse\python\agents\model_registry.yaml
│  (YAML config)    │     Each agent picks its own model
└──────────────────┘
       │
       ▼
┌──────────────────┐
│  LLM Client       │  ← D:\pulse\python\agents\llm_client.py
│  (httpx→OpenRouter│    Retry, error propagation, JSON extraction
│   + OmniRoute)    │
└──────────────────┘
```

---

## Phase 1: Smart Pipeline ✅ (DONE — simplified)

The core agent system routes tasks through two paths:

| Input                         | Classified As | Action                              |
|-------------------------------|--------------|-------------------------------------|
| "what is type hinting"        | chat         | Direct LLM call → answer           |
| "analyze this folder"         | tool         | ReAct agent loop with tools        |
| "create a login endpoint"     | tool         | ReAct agent loop with tools        |
| "add a todo to my list"       | tool         | ReAct agent loop → todo tool       |
| "explain this function"       | chat         | Direct LLM call → answer           |

### Components

| File | Lines | What It Does |
|------|-------|-------------|
| `model_registry.yaml` | 45 | Defines models (id, context_window, max_tokens, cost, capabilities) |
| `model_registry.py` | 42 | Reads YAML, provides model definitions |
| `llm_client.py` | 245 | httpx→OpenRouter/OmniRoute, 3 retries (429/502/503/504), extracts JSON from raw LLM output, SSE streaming support |
| `pipeline.py` | 97 | Auto-classifies: chat vs tool. Routes accordingly |
| `agent_loop.py` | 162 | ReAct agent loop — LLM with tools, executes tool_calls, loops until text response |

### Multi-LLM Split (per role)

| Model ID | Provider | Used For |
|----------|----------|----------|
| `auto/fast` | OmniRoute | Agent loop (default) |
| `auto/best-reasoning` | OmniRoute | Analysis tasks |
| `openrouter/free` | OpenRouter | Direct chat answers |

---

## Phase 2: VS Code Extension ✅ (DONE)

The extension bridges the Python agents to the editor.

### Components

| File | What It Does |
|------|-------------|
| `src/extension.ts` | Registers commands: Chat Panel, Run Pipeline, Start/Stop Agent |
| `src/chat-panel.ts` | Webview that spawns Python pipeline, streams agent/tool cards, shows results |
| `src/acp-client.ts` | JSON-RPC client for Rust ACP server (future use) |
| `.vscode/launch.json` | F5 launches Extension Dev Host with D:\pulse as workspace |

### Commands

| Command | What It Does |
|---------|-------------|
| **Pulse: Open Chat Panel** | Opens webview → type message → pipeline routes to ReAct loop or chat |
| **Pulse: Run Agent Pipeline** | Input task → runs in Output panel |
| **Pulse: Explain This Code** | Selected code → LLM explanation |
| **Pulse: Generate Tests** | Open file → test generation |

---

## Phase 3: Rust ACP Server ⚠️ (PARTIAL)

The Rust binary (`surpassing-acp`) exists at `D:\pulse\crates\surpassing-acp\` but is NOT wired to the Python pipeline yet.

| Component | Status |
|-----------|--------|
| ACP server (`main.rs`) | **DONE** — JSON-RPC 2.0 over stdio |
| `handle_code_generation` | **WRONG** — shells out to `PIPELINE_SCRIPT` env var with hardcoded templates |
| Knowledge graph | **DONE** — SQLite symbols + edges |
| File watcher | **DONE** — AST parser for 6 languages |

**Needs:** Point `PIPELINE_SCRIPT` at `python D:\pulse\python\agents\pipeline.py` so the Rust binary calls our real agents.

---

## Phase 4: Tool-Calling Agent Loop ✅ (DONE)

The Hermes-style ReAct loop is implemented in `agent_loop.py`.

### Architecture

```
User message
    │
    ▼
Agent Loop (agent_loop.py)
    │
    ├── Call LLM with tool definitions + message
    │
    ├── LLM returns text? → Done, deliver to user
    │
    └── LLM returns tool_calls?
          │
          ├── Execute each tool (listFiles, readFile, runCommand, applyEdit, todo)
          ├── Append results to conversation
          └── Call LLM again → loop until text response
```

### Available Tools

| Tool | Description | Parameters |
|------|-------------|------------|
| `listFiles` | List files in a directory | `path, recursive, pattern` |
| `readFile` | Read file contents | `path, maxLines` |
| `runCommand` | Execute shell command | `command, timeout, workdir` |
| `applyEdit` | Write/edit a file | `path, content, mode` |
| `todo` | Manage task items | `action, id, text, status` |

Tools are auto-discovered from `python/agents/tools/` via `discover_tools()` in `tools/__init__.py`.

---

## Phase 5: PulseCodeAI VS Code Fork 🔜 (FUTURE)

After the tool loop works, fork VS Code OSS.

| Step | What |
|------|------|
| 1 | Fork `microsoft/vscode` |
| 2 | Rebrand to PulseCodeAI IDE |
| 3 | Embed Pulse Agent as the default chat participant |
| 4 | Replace Copilot/Cline with our pipeline |
| 5 | Ship as downloadable installer |

---

## File Map

```
D:\pulse\python\agents\           ← Agent Pipeline
├── model_registry.yaml           Model + role definitions
├── model_registry.py             YAML reader
├── llm_client.py                 LLM caller (OpenRouter + OmniRoute)
├── pipeline.py                   Smart orchestrator (chat vs tool)
├── agent_loop.py                 ReAct agent loop with tools
├── tools/
│   ├── __init__.py               Tool auto-discover
│   ├── list_files.py             listFiles tool
│   ├── read_file.py              readFile tool
│   ├── run_command.py            runCommand tool
│   ├── apply_edit.py             applyEdit tool
│   └── todo.py                   ToDo management tool

D:\pulse\adapters\vscode\         ← VS Code Extension
├── src/extension.ts              Extension entry point
├── src/chat-panel.ts             Webview chat panel
├── src/acp-client.ts             ACP JSON-RPC client
├── src/agent/coding-agent.ts     Direct LLM agent (fallback)
├── out/                          Compiled JavaScript
├── package.json                  Extension manifest
└── .vscode/launch.json           F5 launch config

D:\pulse\crates\                  ← Rust ACP Server (future)
├── surpassing-acp/               JSON-RPC server
├── surpassing-sandbox/           Sandboxed execution
├── surpassing-graph/             Knowledge graph
└── surpassing-orchestrator/      Scheduler and registry
```

---

## Build Scorecard

```
Phase 1: Smart Pipeline      ██████████ 100% (simplified to chat/tool)
Phase 2: VS Code Extension   ██████████ 100% (verified)
Phase 3: Rust ACP Server     ██████░░░░  60% (exists, not wired)
Phase 4: Tool-Calling Loop   ██████████ 100% (ReAct loop + 5 tools)
Phase 5: VS Code Fork        ░░░░░░░░░░   0% (future)
```
