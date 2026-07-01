# Surpassing IDE Agent — Commercial Roadmap

> **Startup**: Profitable, closed-source
> **Product**: Next-gen AI coding assistant — protocol-first, multi-agent, self-improving
> **Current Build**: v0.1.0 — 9 Rust crates, 49 source files, ~18K lines of Rust

---

## Current State Analysis

### ✅ What's Built (Proven & Working)

| Layer | Crate | Status | What It Does |
|-------|-------|--------|-------------|
| **Core** | `surpassing-core` (37 lines) | **DONE** | Error types, tracing, async utils, shared types (Position, Range, Symbol) |
| **L1 — ACP Protocol** | `surpassing-acp` (847 lines) | **DONE** | JSON-RPC 2.0 server over stdio, 4 handlers (initialize, chat, shutdown, context/query), code generation pipeline |
| **L2 — Parser** | `surpassing-indexer` (857 lines) | **DONE** | tree-sitter parser for 6 languages (Rust, Python, JS, TS, Go, Java), symbol extraction, file watcher via `notify` |
| **L2 — Graph** | `surpassing-graph` (871 lines) | **DONE** | SQLite knowledge graph — symbols table + edges table + files table, query by name/type/file/callers/callees |
| **L3 — Orchestrator Bus** | `surpassing-orchestrator` (558 lines) | **DONE** | Context bus (broadcast channel + history), agent registry (5 agent types), scheduler (DAG dependency resolver) |
| **L6 — Sandbox** | `surpassing-sandbox` (592 lines) | **DONE** | Docker-first sandbox with direct fallback, regex security scanner (6 languages), git integration |
| **Binary** | `surpassing-acp/src/main.rs` | **DONE** | CLI entry point, resolves graph path via SURPASSING_WORKSPACE env var |

### 🔶 Stubs (Skeleton Only — Needs Full Implementation)

| Layer | Module | Status | Current Content |
|-------|--------|--------|----------------|
| **L3 — Orchestrator** | Agent execution | **STUB** | Registry and scheduler are done, but no actual agent process spawning |
| **L4 — Router** | `surpassing-router/src/router.rs` | **STUB** | `pub fn init() { /* TODO */ }` |
| **L4 — Router** | `surpassing-router/src/classifier.rs` | **STUB** | `pub fn init() { /* TODO */ }` |
| **L4 — Router** | `surpassing-router/src/registry.rs` | **STUB** | `pub fn init() { /* TODO */ }` |
| **L5 — Memory** | `surpassing-memory/src/store.rs` | **STUB** | `pub fn init() { /* TODO */ }` |
| **L5 — Memory** | `surpassing-memory/src/tiers.rs` | **STUB** | `pub fn init() { /* TODO */ }` |
| **L5 — Memory** | `surpassing-memory/src/search.rs` | **ABSENT** | Module declared, file may exist but is todo-level |
| **L7 — Security** | `surpassing-security/src/scanner.rs` | **STUB** | `pub fn init() { /* TODO */ }` |
| **L7 — Security** | `surpassing-security/src/governance.rs` | **STUB** | `pub fn init() { /* TODO */ }` |
| **L7 — Security** | `surpassing-security/src/audit.rs` | **STUB** | `pub fn init() { /* TODO */ }` |
| **L8 — Collaboration** | Not started | **MISSING** | No crate, no module |

### ❌ What's Missing Entirely

| Component | Why It Matters |
|-----------|---------------|
| **Python agents** (Planner, Coder, Reviewer, Tester, Debugger) | The swarm intelligence layer — currently the ACP binary shells out via `PIPELINE_SCRIPT` env var |
| **IDE adapters** (VS Code, JetBrains, Zed, Neovim, Emacs) | Zero IDE integrations exist — no way for developers to actually use this |
| **LLM provider integrations** | No actual LLM calls — the code generation handler uses hardcoded templates |
| **Memory persistence** | No cross-session memory, no search, no recall |
| **Security governance / audit** | Scanner detects patterns but governance gates and audit trails are empty stubs |
| **Human-AI collaboration** | No pair programming, explainability, or learning loop |
| **Tests** | Only 2 integration test files (acp/tests, indexer/tests) — no E2E tests |

---

## PHASE 1: Foundation Hardening (Weeks 1-3)
*Make the prototype production-ready — polish what exists before building new*

### Milestone 1.1: Test Infrastructure

| Task | Test | User Verification |
|------|------|-------------------|
| Set up `cargo test` CI with `--workspace` | All 100+ unit tests pass | `cargo test --workspace` exits 0 |
| Add property-based tests for Knowledge Graph | `proptest` on symbol insert/query/edge operations | Query returns correct results for random inputs |
| Add fuzz harness for ACP message parsing | `cargo-fuzz` on JSON-RPC parsing | Malformed JSON returns error, doesn't panic |
| Set up integration test fixtures | Temp workspace with known Rust/Python/TS files | Tests create workspace, write files, parse, query |
| Add benchmark suite | `criterion` benchmarks for parser, graph, bus | Hot paths measured, regression gate in CI |

### Milestone 1.2: Reliability & Error Handling

| Task | Test | User Verification |
|------|------|-------------------|
| Fix all `unwrap()` calls in production code | `clippy -- -D warnings` passes | No panics on invalid input |
| Add graceful degradation for all crates | Each crate tests `SurpassingError` variants | System continues with reduced capability when subsystem fails |
| Add structured logging boundaries | Every public function has `#[tracing::instrument]` | Logs show complete request/response flow |
| Handle Windows paths correctly | Cross-platform path tests on Windows CI | `file:///C:/...` paths resolve correctly |
| Add timeout for pipeline subprocess | `tokio::time::timeout` in `handle_code_generation` | Long-running Python pipeline doesn't hang |

### Milestone 1.3: Security Baseline

| Task | Test | User Verification |
|------|------|-------------------|
| Complete security scanner (L7) | Scanner tests for all 6 languages + 20+ patterns | Dangerous code patterns are flagged before execution |
| Build governance approval gates | Test HITL approval flow | Destructive operations blocked without human sign-off |
| Add audit trail persistence | SQLite audit log | All operations logged with timestamp, user, result |
| Entropy-based secret detection | Tests with known API key patterns | `sk-...` and `ghp_...` patterns detected |

### Phase 1 User Verification Checklist

```
[ ] `cargo test --workspace` passes clean
[ ] `cargo clippy -- -D warnings` exits 0
[ ] Start `surpassing` binary — "ACP server starting" logged
[ ] Send `{"jsonrpc":"2.0","id":1,"method":"surpassing/initialize","params":{"rootUri":"file:///tmp/test"}}` — receives capabilities
[ ] Parse a Rust file, query "what is functionX?" — gets file + line + signature
[ ] Dangerous code (eval, exec, os.system) blocked by sandbox
[ ] Destructive operation (rm -rf) triggers HITL gate
[ ] All logs show structured JSON with trace IDs
```

---

## PHASE 2: LLM Integration (Weeks 4-6)
*Replace hardcoded templates with real LLM calls*

### Milestone 2.1: LLM Router (L4 — Full)

| Task | Test | User Verification |
|------|------|-------------------|
| Implement model registry | Registry holds model list with capability tags | Router knows available models |
| Build privacy classifier | Regex + entropy → Route to local-only | API keys in prompt → forced local |
| Build complexity classifier | Token count + task keywords → Route to appropriate tier | Simple refactor → cheap/fast, architecture → capable |
| Build cost-performance optimizer | Track cost per session, optimize routing | Budget cap enforced, cheapest adequate model used |
| Provider integrations: Ollama, OpenRouter, Groq | Each provider returns valid response | Multiple LLM backends interchangeable at config level |
| Fallback chain (Groq → Together → Firecrawl → Cloud) | Provider failure auto-retries next in chain | One provider down → transparent failover |

### Milestone 2.2: Python Agent Pipeline

| Task | Test | User Verification |
|------|------|-------------------|
| Implement Planner agent | Python: parse task → emit structured plan with dependencies | `"create an auth system"` returns plan with ordered subtasks |
| Implement Coder agent | Python: take plan → generate code for each subtask | Generated code compiles/runs |
| Implement Reviewer agent | Python: analyze generated code for issues | Review comments with severity levels |
| Implement Tester agent | Python: generate tests for generated code | Tests pass after code generation |
| Implement Debugger agent | Python: analyze errors → suggest fixes | Error stack trace → root cause + fix suggestion |
| Wire pipeline via context bus | Planner writes plan → Coder reads → Reviewer reads → Tester runs | Full multi-agent workflow in sequence |

### Milestone 2.3: Real LLM Code Generation

| Task | Test | User Verification |
|------|------|-------------------|
| Remove hardcoded templates from `handlers.rs` | All code gen routed through LLM | No `generate_code_from_request` fallback |
| Streaming response via ACP | Partial results sent as they arrive | First token appears < 2s, no spinner delay |
| Multi-file code generation | Planner outputs multiple file changes | "create REST API" → 3+ files with imports wiring |
| Diff-based code output | `suggestedEdits` in ACP response contains `original` + `modified` | User sees diff, not full file |

### Phase 2 User Verification Checklist

```
[ ] "Write hello world" → code generated by real LLM, not template
[ ] "Add a function" → diff shown, not full file
[ ] API keys in prompt → request routed to local model
[ ] Simple query → cheap model used (router stats visible)
[ ] One provider down → automatic failover
[ ] "Create a REST API" → Planner outputs 5+ subtasks
[ ] Generated code passes Coder → Reviewer → Tester pipeline
[ ] Planner output visible in shared context bus
```

---

## PHASE 3: IDE Integration (Weeks 7-10)
*Make it usable from actual editors*

### Milestone 3.1: VS Code Extension (Priority)

| Task | Test | User Verification |
|------|------|-------------------|
| Write VS Code extension (TypeScript) | Extension activates on load with ACP server | Command "Surpassing: Activate" starts agent |
| Implement inline completions | ACP `surpassing/completion` → returns suggestions | Typing code shows ghost text suggestions |
| Implement chat panel | WebView panel with message history | Right-side panel for agent conversation |
| Implement diff viewer | VS Code `createTextEditorDecorationType` | Accept/reject individual diff hunks |
| Implement file tree context | Extension sends `rootUri` on init | Agent knows which project is open |

### Milestone 3.2: Additional IDE Adapters

| Task | Test | User Verification |
|------|------|-------------------|
| JetBrains plugin (Kotlin) | Plugin registers LSP-compatible ACP client | "Surpassing" tool window in IntelliJ |
| Neovim plugin (Lua) | `surpassing.nvim` with commands | `:SurpassingChat` opens floating window |
| Standalone TUI (Rust) | Cross-platform terminal app | `surpassing tui` runs full agent in terminal |

### Milestone 3.3: ACP Protocol Polish

| Task | Test | User Verification |
|------|------|-------------------|
| `surpassing/completion` — inline code completion | Returns `[{text, range, score}]` | VS Code shows ghost text matching context |
| `surpassing/diagnostic` — code analysis results | Returns lint-style diagnostics | Red squiggles for errors, yellow for warnings |
| `surpassing/codeAction` — quick fixes | Returns `{title, edit}` actions | Lightbulb menu shows AI-suggested fixes |
| `surpassing/hover` — symbol info on hover | Returns formatted documentation | Hover shows docstring + callers + callees |

### Phase 3 User Verification Checklist

```
[ ] VS Code extension activates → agent status visible
[ ] Open Rust/Python file → symbols indexed (see status)
[ ] Type `fn calc` → ghost text completion appears
[ ] Open chat panel → ask "what symbols are in this file" → correct list
[ ] Accept diff → file modified in editor
[ ] Hover over function → see docs + callers + callees
[ ] JetBrains/Neovim show same experience (if applicable)
[ ] Standalone TUI: `surpassing chat` works
```

---

## PHASE 4: Memory & Persistence (Weeks 11-13)
*Make the agent remember everything*

### Milestone 4.1: 5-Tier Memory (L5 — Full)

| Task | Test | User Verification |
|------|------|-------------------|
| **Tier 1 — Codebase Memory** | Auto-extract architect from ADR files, comments | Agent knows project conventions without being told |
| **Tier 2 — Developer Profile** | Track accept/reject rate, infer style preferences | Agent adapts to user's coding style over 3+ sessions |
| **Tier 3 — Session Memory** | Compress + store full conversation, checkpoint snapshots | `surpassing session list` shows all past sessions |
| **Tier 4 — Cross-Project** | Shared learnings across projects (opt-in) | Bug fix in Project A → Project B doesn't repeat same bug |
| **Tier 5 — Skills** | Auto-detect repeated workflows → suggest skill | After 3rd "add REST endpoint" → "Save as skill?" |

### Milestone 4.2: Knowledge Graph Enhancement

| Task | Test | User Verification |
|------|------|-------------------|
| Add FTS5 full-text search | SQLite FTS5 on symbol names + docstrings | `"find all functions with 'auth' in name"` |
| Add vector embeddings | LanceDB for semantic search of code | `"find the file that handles JWT tokens"` works semantically |
| Incremental re-indexing | Watch for file changes, update only changed files | Edit file → graph updates in <100ms |
| Cross-reference resolution | Follow `use`/`import` statements across files | "Where is this import defined?" → resolved file + line |

### Milestone 4.3: Session Persistence

| Task | Test | User Verification |
|------|------|-------------------|
| Save session to SQLite on shutdown | `last_session.db` has full message log | Restart agent → "Continue last session?" |
| Session restore on startup | Replay last N messages for context | Agent remembers what was discussed before restart |
| Session search | `surpassing search session "auth bug"` returns relevant sessions | Quick recall of past work |

### Phase 4 User Verification Checklist

```
[ ] Write code → next session: "Remember how I handled errors?" → agent recalls
[ ] Refuse 3 suggestions → agent stops suggesting that pattern
[ ] After 3 "add route" → agent prompts: "Save as skill?"
[ ] "Find where JWT is handled" → semantic search finds it
[ ] Edit file → graph updates within 100ms
[ ] Kill agent, restart → "Continue last session?"
[ ] Cross-project: fix in project A → similar code in project B flagged
[ ] `session search "deployment bug"` → returns correct session
```

---

## PHASE 5: Multi-Agent Swarm (Weeks 14-17)
*Full parallel agent orchestration*

### Milestone 5.1: Parallel Agent Execution

| Task | Test | User Verification |
|------|------|-------------------|
| Scheduler spawns agent tasks in parallel waves | 3 independent subtasks run concurrently | Task timeline shows parallel execution |
| Context bus connects all agents in real-time | All agents subscribe to bus, see each other's output | Planner sees Coder's progress, Coder sees Reviewer's notes |
| Conflict resolution (Coder vs Reviewer disagree) | Escalation with options, HITL on disagreement | "Coder and Reviewer disagree on approach. Options: A)..., B)..., C)..." |
| Token budget enforcement | Kill long-running agents, summarize partial output | Agent that exceeds budget → summary shown, user decides |

### Milestone 5.2: Predictive Intent

| Task | Test | User Verification |
|------|------|-------------------|
| Build intent predictor (lightweight ML model) | Trained on user edit patterns | Before user finishes typing, agent suggests next edit |
| Embedding-based code context matching | Vector similarity of current file vs past edits | Agent suggests "You usually add a test after writing a function" |

### Milestone 5.3: Agent Mode System

| Task | Test | User Verification |
|------|------|-------------------|
| Feature mode | Full plan → code → review → test → commit | "Add user authentication" → complete feature in one command |
| Bugfix mode | Debugger analyzes → Coder fixes → Tester validates | "Fix crash on empty input" → root cause fix + regression test |
| Refactor mode | Planner identifies all touch points → Coder refactors → Reviewer validates | "Extract payment logic to module" → safe, validated refactor |
| Docs mode | Coder generates docs → Reviewer checks coverage | "Document the auth module" → complete docstrings + README |

### Phase 5 User Verification Checklist

```
[ ] "Add login, signup, and password reset" → Planner spawns 3 parallel tasks
[ ] Context bus shows real-time agent activity (like GitHub Actions UI)
[ ] Coder and Reviewer disagree → escalation dialog
[ ] Before typing "def test_..." → agent suggests: "Testing the auth module?"
[ ] "Fix crash" → Debugger finds root cause, Coder fixes, Tester adds regression test
[ ] "Extract payment module" → all references updated, no breakage
[ ] Agent mode selector: /feature, /bugfix, /refactor, /docs
```

---

## PHASE 6: Security & Enterprise (Weeks 18-21)
*Enterprise-grade security, compliance, and multi-tenant*

### Milestone 6.1: Full Security Suite

| Task | Test | User Verification |
|------|------|-------------------|
| Complete SAST scanner (multi-language) | 50+ security patterns across all 6 languages | Scans every generated/reviewed code change |
| Dependency vulnerability scanning | Cargo-deny/Trivy integration | "This dependency has CVE-2026-XXXXX" |
| Secret scanning pre-commit | Scans staged changes for secrets | `ghp_...` or `sk-...` in diff → blocked |
| SBOM generation | CycloneDX JSON output | `surpassing sbom` generates bill of materials |

### Milestone 6.2: Governance & Compliance

| Task | Test | User Verification |
|------|------|-------------------|
| Audit trail with export | All agent actions logged to tamper-proof audit DB | `surpassing audit export --since 7d` → CSV/JSON |
| Approval workflows | Role-based approval gates (admin, reviewer, dev) | Destructive ops require 2nd person approval |
| Compliance reports | SOC2/CIS benchmark mapping | "85% of security controls passing" |

### Milestone 6.3: Multi-Tenant & SSO

| Task | Test | User Verification |
|------|------|-------------------|
| Team workspace isolation | Each team gets separate graph DB + memory store | Team A's data never visible to Team B |
| SSO (OIDC/SAML) | Login with Google/GitHub/Enterprise SSO | `surpassing auth login` opens browser |
| Role-based access control | Admin/Editor/Viewer roles | API rejects unauthorized role actions |

### Phase 6 User Verification Checklist

```
[ ] SAST scan on every code change — findings shown in chat
[ ] Secret detected in diff → blocked with red alert
[ ] `surpassing sbom` generates valid CycloneDX JSON
[ ] Audit log shows every operation with timestamp + user
[ ] Approval gate: "Delete 5 files" → "Requires admin approval"
[ ] SSO login: browser flow completes → agent authenticated
[ ] Role test: Viewer tries to write code → "Read-only mode"
```

---

## PHASE 7: Human-AI Collaboration (Weeks 22-25)
*Pair programming, learning loop, explainability*

### Milestone 7.1: Pair Programming

| Task | Test | User Verification |
|------|------|-------------------|
| Real-time collaborative editing | Agent edits in one pane, user in another | Both can write simultaneously without conflict |
| Agent observes + suggests | Agent watches cursor position, file changes | Suggests completions based on current edit context |
| "Drive" mode toggle | User drives (agent suggests) vs Agent drives (agent writes, user reviews) | Mode switch without stopping workflow |

### Milestone 7.2: Explainability

| Task | Test | User Verification |
|------|------|-------------------|
| Decision trace for every suggestion | Show which context files influenced decision | "Why this change?" → shows 3 relevant files + reasoning |
| Confidence scores on all output | 0-100% shown next to each suggestion | Low-confidence suggestions highlighted for review |
| Alternative approaches | Agent shows top 3 approaches with trade-offs | "Alternative: A)..., B)..., C)..." |
| Token cost breakdown | Cost per LLM call shown in chat | "This task cost $0.04 (3 calls)" |

### Milestone 7.3: Learning Loop

| Task | Test | User Verification |
|------|------|-------------------|
| Correction tracking | User manual edits → agent learns pattern | Next time: "You prefer tabs over spaces, applying." |
| Skill auto-extraction | Repeated 3+ step patterns → skill draft | "I've noticed you often add input validation. Save as skill?" |
| Preference decay | Old preferences weigh less over time | Agent adapts when user changes their style |

### Phase 7 User Verification Checklist

```
[ ] Pair programming: agent and user editing same file simultaneously
[ ] "Why did you suggest that?" → decision trace shows 3 context files
[ ] Suggestion shows confidence: "95% sure" vs "This is a guess (30%)"
[ ] "Show alternatives" → 3 approaches with trade-off analysis
[ ] Reject suggestion → agent refines: "Like this instead?"
[ ] After 3 "add validation" → agent prompts: "Save as workflow skill?"
[ ] `/cost` command shows total session spend
```

---

## PHASE 8: Revenue & Scaling (Weeks 26-30)
*Turn the product into a profitable business*

### Milestone 8.1: Pricing Tiers

| Tier | Price | Features |
|------|-------|----------|
| **Individual** | $20/mo | All features, 1 seat, 5 projects, community support |
| **Team** | $50/seat/mo | All features, shared memory, SSO, priority support |
| **Enterprise** | Custom | On-premise, audit exports, compliance reports, SLA |

### Milestone 8.2: Usage Tracking & Billing

| Task | Test | User Verification |
|------|------|-------------------|
| Token usage metering | Every LLM call tracked by user, project, tier | Dashboard shows daily/weekly usage |
| Stripe billing integration | Subscribe → Stripe checkout → activated | `surpassing subscribe` opens payment flow |
| Usage-based pricing option | $0.01/1K tokens for overflow beyond plan | Fair billing for heavy users |
| Plan upgrade/downgrade | Change plan mid-cycle, prorated | Seamless plan change, no downtime |

### Milestone 8.3: Distribution Channels

| Task | Target | Launch Strategy |
|------|--------|-----------------|
| VS Code marketplace | 500+ installs in first month | Free tier, viral "before/after" demos |
| JetBrains marketplace | Cross-reference with VS Code | Dual-IDE marketing |
| `npm install -g surpassing` | Developer CLI | `brew install surpassing` |
| Docker image | CI/CD integration | `surpassing ci-review` for PRs |

### Phase 8 User Verification Checklist

```
[ ] `surpassing subscribe` → Stripe checkout → "You're on Individual plan"
[ ] Dashboard shows token usage: "Today: 12,341 tokens ($0.12)"
[ ] Upgrade to Team → SSO + shared memory available immediately
[ ] VS Code extension installs from marketplace → activate with license key
[ ] `npm install -g surpassing` → `surpassing chat` works
[ ] Docker: `docker run surpassing` → ACP server listens on stdin
```

---

## Complete Test Matrix (All Phases)

| Test Category | Count Target | Tools | When |
|--------------|-------------|-------|------|
| Unit tests | 200+ | `cargo test`, `pytest` | Every PR |
| Integration tests | 50+ | Custom test harness | Every PR |
| Property-based tests | 20+ | `proptest` | Phase 1+ |
| Fuzz tests | 5+ | `cargo-fuzz` | Phase 1+ |
| E2E tests | 10+ | Custom ACP test client | Every release |
| Benchmark suite | 15+ | `criterion` | Phase 1, then nightly CI |
| Security scan tests | 50+ | Custom simulator | Phase 1, expanded ongoing |
| Performance regression tests | 10+ | `criterion` comparison | Nightly CI |
| Cross-platform tests | 3 (Win/Mac/Linux) | CI matrix | Every release |

---

## Key Performance Targets

| Metric | Target | Measurement |
|--------|--------|-------------|
| File change detection | < 50ms | `notify` latency bench |
| AST incremental parse | < 100ms for <10K lines | `criterion` |
| Knowledge graph query (3-hop) | < 200ms | SQLite query timing |
| First token (Edge LLM) | < 100ms | Provider latency |
| First token (Cloud LLM) | < 2s | Provider latency |
| Full feature task | < 30s | End-to-end chrono |
| Memory write | < 50ms | Async append bench |
| Security scan per file | < 500ms | Regex scan bench |
| UI interaction latency | < 100ms | VS Code extension perf |

---

## Build Scorecard

```
Phase 1: Foundation    ████████░░ 80% (3 weeks)
Phase 2: LLM           ██░░░░░░░░ 20% (starting from stubs)
Phase 3: IDE           ░░░░░░░░░░  0% (nothing started)
Phase 4: Memory        ░░░░░░░░░░  0% (stubs only)
Phase 5: Multi-Agent   ██░░░░░░░░ 20% (bus/registry done)
Phase 6: Enterprise    ░░░░░░░░░░  0%
Phase 7: Collab        ░░░░░░░░░░  0%
Phase 8: Revenue       ░░░░░░░░░░  0%
```

---

> **Next Immediate Action**: Phase 1 Milestone 1.1 — set up CI with `cargo test --workspace`, add missing test fixtures, and get a green build. Then attack Phase 2 (LLM router + Python agents) to replace the hardcoded templates.
