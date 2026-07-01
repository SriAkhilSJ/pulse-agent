# Prompt Engineering Applied to Pulse

## Files Created / Modified

| File | Action | Purpose |
|------|--------|---------|
| `D:/pulse/python/agents/prompt_blocks.py` | **NEW** | All guidance constants + helpers (identity, task completion, tool-use enforcement, parallel calls, model-specific guidance, platform/environment hints) |
| `D:/pulse/python/agents/prompt_assembly.py` | **NEW** | 3-tier system prompt builder (stable + context + volatile), context file discovery, prompt injection defense |
| `D:/pulse/python/agents/agent_loop.py` | **UPDATED** | Uses `prompt_assembly.build_system_prompt()` instead of 2-liner; cached per session; `--platform` arg |
| `D:/pulse/python/agents/pipeline.py` | **UPDATED** | Passes `platform` hint through to agent_loop |
| `D:/pulse/python/agents/tools/list_files.py` | **UPDATED** | Richer description with behavioral guidance |
| `D:/pulse/python/agents/tools/read_file.py` | **UPDATED** | Richer description with behavioral guidance |
| `D:/pulse/python/agents/tools/apply_edit.py` | **UPDATED** | Richer description with behavioral guidance |
| `D:/pulse/python/agents/tools/run_command.py` | **UPDATED** | Richer description with behavioral guidance |
| `D:/pulse/PULSE.md` | **NEW** | Project context file (auto-injected as context tier, like SOUL.md in Hermes) |
| `D:/hermes/HERMES_PROMPT_ENGINEERING_ANALYSIS.md` | **NEW** | Full analysis of Hermes prompt engineering |

## What Was Added vs Hermes

### 3-Tier System Prompt
```
STABLE:   Identity → Task Completion → Parallel Tool Calls → Tool Enforcement
          → Model Guidance → Environment Hints → Python Probe → Platform Hint
CONTEXT:  system_message + PULSE.md (project context file)
VOLATILE: Workspace path → Model/Provider → Timestamp
```

### Guidance Blocks Installed
1. **Identity** — "Pulse Agent, the AI coding assistant for PulseCodeAI IDE"
2. **Task Completion** — deliver working artifacts, never fabricate
3. **Parallel Tool Calls** — batch independent reads/searches
4. **Tool-Use Enforcement** — call tools, don't just describe plans
5. **OpenAI Execution Discipline** — tool persistence, mandatory tool use, verification
6. **Google Operational Guidance** — absolute paths, verify first, dependency checks
7. **Environment Hints** — host OS, user home, cwd, shell type
8. **Python Toolchain Probe** — one-liner when pip/uv are non-default
9. **Platform Hints** — CLI/IDE/API output conventions

### Model-Gated Injection
- GPT/Codex/Grok → enforcement + execution discipline
- Gemini/Gemma → enforcement + operational guidance
- Claude (and others) → no extra enforcement

### Context File Injection
- `PULSE.md` discovered automatically in workspace root
- Parent-directory search up to git root
- Prompt injection defense blocks known attack patterns

## Usage

```bash
# CLI mode (default)
python pipeline.py --task "analyze this folder" --context D:/pulse

# IDE mode (webview panel)
python pipeline.py --task "find bugs in main.py" --context D:/pulse --platform ide

# API mode (plain text responses)
python pipeline.py --task "explain async/await" --platform api
```
