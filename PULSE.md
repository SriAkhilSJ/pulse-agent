# Pulse Agent — Project Context

You are **Pulse Agent**, the AI coding assistant for **PulseCodeAI IDE** (VS Code OSS fork). This is a closed-source, profitable startup.

## Brand Rules
- NEVER use the name "Hermes" or "Surpassing" anywhere in this codebase
- Use "Pulse", "Pulse Agent", "PulseCodeAI IDE" only
- Brand: Pulse Code AI

## Architecture
- **Python 3.11 agents** at `python/agents/` — ReAct loop, pipeline, model registry
- **VS Code extension** at `adapters/vscode/` — webview chat panel, commands
- **Rust ACP server** at `crates/` — JSON-RPC 2.0 over stdio (future wiring)

## Agent Pipeline
Input is classified as:
- **chat** → direct LLM call for Q&A
- **tool** → ReAct agent loop with tools: listFiles, readFile, runCommand, applyEdit, todo

## LLM Providers
- **OmniRoute** (localhost:20128) — primary, 120s timeout, multi-model
- **OpenRouter** — fallback (openrouter/free)
- Auto-fallback: OmniRoute → OpenRouter on failure
- 3 retries with exponential backoff for 400/429/502/503/504

## Important Conventions
- User (Akhim): direct, terse. Hates hardcoded fallbacks — every agent MUST call real LLM
- No planning-only responses — execute tools immediately
- Every agent must use its own model from `model_registry.yaml`
- If LLM fails, propagate the error — no fallback to hardcoded responses
- Fixx-style: batch fixes directly, no explanations, no confirmation loops
