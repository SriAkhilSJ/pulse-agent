# PulseCodeAI IDE — IDE Spec Components Build Plan

> Goal: Port IDE-spec components from Hermes agent architecture into Pulse Agent.
> Scope: ONLY agent IDE capabilities — session persistence, approval gates, MCP, skills, tool search, tool expansion.
> Strategy: Build each component as a standalone Pulse module, decoupled from existing code where possible.

---

## Phase 1: Session DB (FTS5 SQLite) ✅ BUILT
**File:** `python/agents/session_db.py` (443 lines)
**Depends on:** Nothing
**Can delegate to another agent:** ✅ YES — fully independent
**Status:** ✅ Verified — create/read/list/search/prune all work

FTS5-backed SQLite session store with:
- Sessions table (id, title, model, provider, timestamps, metadata)
- Messages table (role, content, tool_calls, tool_call_id, msg_index)
- FTS5 virtual table for full-text search across all messages
- Auto-sync triggers (insert/delete FTS updates)
- WAL mode for concurrent reads
- Prune old sessions (configurable TTL)
- `search_sessions(query)` for cross-session recall
- Thread-local connections (thread-safe)

---

## Phase 2: Tool Approval Gates ✅ BUILT
**File:** `python/agents/approval.py` (370 lines)
**Depends on:** Nothing (can log to Session DB if available, but works standalone)
**Can delegate to another agent:** ✅ YES — fully independent
**Status:** ✅ Built — policy-based approval system

Approval system for IDE file operations:
- `ApprovalManager.check_approval(path, content, mode)` → decision
- `ApprovalPolicy` with configurable:
  - Allow globs (auto-approve: .md, .txt, .json, etc.)
  - Deny globs (always block: .git, node_modules, .venv, etc.)
  - Dangerous extensions (.env, .key, .pem, .exe, .dll, etc.)
  - Auto-approve threshold (N writes per session before prompting)
- `ApprovalRequest` lifecycle: create → pending → resolve/expire
- Structured JSON events emitted for webview rendering
- Audit trail to Session DB (when available)
- `with_approval()` decorator for wrapping tool functions

---

## Phase 3: MCP Client ✅ BUILT
**Files:** `python/agents/mcp_client.py` (460 lines)
**Depends on:** Nothing (pure networking)
**Can delegate to another agent:** ✅ YES — fully independent
**Status:** ✅ Built — MCP stdio client with multi-server registry

Model Context Protocol client:
- `MCPClient` — single server connection over stdio subprocess
  - JSON-RPC 2.0 protocol (initialize, tools/list, tools/call)
  - Background reader thread for async responses
  - Timeout handling (init: 10s, list: 15s, call: 60s)
  - Graceful disconnect with SIGKILL fallback
  - Cross-platform (Windows/Mac/Linux subprocess handling)
- `MCPRegistry` — multi-server manager
  - Add/remove/discover servers
  - `connect_all()` / `disconnect_all()`
  - `get_all_tools()` / `call_tool(server, tool, args)`
- `MCPServerConfig.from_dict()` — config file parsing
- `create_mcp_tool_proxies()` — auto-wrap MCP tools for Pulse's registry
- Proper exception hierarchy (MCPConnectionError, MCPCallError, MCPToolNotFoundError)

---

## Phase 4: Skills System 🔴 NOT YET BUILT
**Files:** (not created)
**Depends on:** Phase 1 (Session DB for persistence) + Phase 5 (Tool Search for discovery)
**Can delegate to another agent:** ❌ NO — depends on Phase 1 + 5

Skills management — agent learns and reuses procedures:
- SkillManager CRUD
- Skill search/load
- Agent-facing SkillTool
- Auto-injection of relevant skills into system prompt

---

## Phase 5: Tool Search + Dynamic Filtering ✅ BUILT
**File:** `python/agents/tool_search.py` (280 lines)
**Depends on:** Phase 1 for usage analytics (but works standalone)
**Can delegate to another agent:** ✅ YES — independent base, Phase 1 adds analytics
**Status:** ✅ Built — replaces flat discover_tools() with rich registry

Dynamic tool discovery and context-aware filtering:
- `ToolRegistry` class with register/search/filter
- `ToolInfo` dataclass: name, description, parameters, category, danger_level, keywords
- `ToolCategory` constants: code_read, code_write, file_ops, search, execution, etc.
- `ToolDangerLevel`: safe → critical
- `search(query)` — ranked by relevance (name match > keyword > desc)
- `get_tools_for_context(task_type, has_lsp, has_network)` — context-aware filtering
- `to_openai_format(task_type)` — single call for agent integration
- `discover_tools_from_directory()` — replaces `tools/__init__.py discover_tools()`
- Usage tracking for relevance ordering

---

## Phase 6: Tool Ecosystem Expansion ✅ BUILT (7 new tools)
**Files:** `python/agents/tools/*.py`
**Depends on:** Phase 1 for session_search, otherwise independent per tool
**Can delegate to another agent:** ✅ YES — each tool fully independent
**Status:** ✅ Built — 7 new tools added (18 total now)

| Tool | File | Purpose | Priority |
|------|------|---------|----------|
| `webSearch` | `tools/web_search.py` | Web search (DDGS + httpx fallback) | HIGH |
| `patch` | `tools/patch_tool.py` | Targeted find-and-replace with fuzzy matching | HIGH |
| `memoryWrite` | `tools/memory_write.py` | Save facts to persistent memory | MEDIUM |
| `memoryRead` | `tools/memory_read.py` | Recall saved facts | MEDIUM |
| `sessionSearch` | `tools/session_search.py` | FTS5 session search (needs Phase 1) | MEDIUM |
| `readFileLines` | `tools/read_file_lines.py` | Read specific lines (offset+limit) | MEDIUM |
| `gitStatus` | `tools/git_status.py` | Quick git repo summary | LOW |
| `thinkTool` | `tools/think_tool.py` | No-op reasoning tool | LOW |

---

## Build Order (Updated)

```
Phase 1 ────────────►  ───────────────► Phase 4 (needs 1+5)
   │                          │
   │                          └──► Phase 5 ──────► Phase 4
   │
   └──► Phase 2 (standalone)
   
Phase 3 ────────────►  (standalone)

Phase 6 ────────────►  (each tool standalone)
```

## Connection Map for Delegation

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  PHASE 1: Session DB        ██████████████████████████████████████████ 100%  │
│  ═══ INDEPENDENT — can delegate to another agent                           │
├──────────────────────────────────────────────────────────────────────────────┤
│  PHASE 2: Approval Gates    ██████████████████████████████████████████ 100%  │
│  ═══ INDEPENDENT — no deps on other phases                                 │
├──────────────────────────────────────────────────────────────────────────────┤
│  PHASE 3: MCP Client        ██████████████████████████████████████████ 100%  │
│  ═══ INDEPENDENT — no deps on other phases                                 │
├──────────────────────────────────────────────────────────────────────────────┤
│  PHASE 4: Skills System     ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   0%  │
│  ═══ WAITS FOR: Phase 1 (Session DB) + Phase 5 (Tool Search)               │
├──────────────────────────────────────────────────────────────────────────────┤
│  PHASE 5: Tool Search       ██████████████████████████████████████████ 100%  │
│  ═══ CAN RUN STANDALONE — Phase 1 adds analytics but not required           │
├──────────────────────────────────────────────────────────────────────────────┤
│  PHASE 6: Tool Expansion    ██████████████████████████████████████████ 100%  │
│  ═══ INDEPENDENT (except sessionSearch needs Phase 1)                      │
└──────────────────────────────────────────────────────────────────────────────┘
```
