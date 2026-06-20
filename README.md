# PulseCode AI IDE

Monorepo for PulseCode AI IDE — an autonomous AI coding assistant.

## Architecture

```
pulse-ide/
├── packages/
│   ├── shared/       # Shared types & protocols (AG-UI, ACP)
│   ├── backend/      # Node.js agent service (WebSocket server)
│   └── frontend/     # Electron + React UI
├── scripts/          # Build & dev scripts
├── patches/          # VS Code patches (if forking)
└── README.md
```

## Quick Start

```bash
# Install dependencies
pnpm install

# Build shared package first (required by backend & frontend)
pnpm build:shared

# Build all packages
pnpm build

# Run backend
pnpm dev:backend

# Run frontend (in another terminal)
pnpm dev:frontend
```

## Backend

The backend is a standalone Node.js service with:
- WebSocket server (AG-UI protocol)
- Agent loop (Claude Code / Cursor pattern)
- Tool registry (file, terminal, git, web, todo, change tracking)
- Context engine (codebase indexer with RAG search)
- Skills loader
- Session management
- Semantic cache
- Docker sandbox (optional)

### Environment

Copy `.env.example` to `.env` and configure:
- `PROVIDER` — LLM provider (openrouter, custom, etc.)
- `{PROVIDER}_API_KEY` — API key
- `{PROVIDER}_URL` — Base URL
- `{PROVIDER}_MODEL` — Model name

## Frontend

Electron + React UI with:
- Chat panel (streaming, tool steps, thinking)
- Monaco editor integration (coming soon)
- Diff view (coming soon)
- Inline suggestions (coming soon)
- Zustand state management
- WebSocket connection to backend

## Packages

### @pulse-ide/shared
- `types/` — Core types (Message, ToolStep, AgentConfig, etc.)
- `protocols/` — AG-UI events, ACP protocol, WebSocket packets

### @pulse-ide/backend
- `agent/` — Core agent loop
- `tools/` — All tool implementations
- `context/` — Indexer, compressor, semantic cache
- `observability/` — Tracing
- `sandbox/` — Docker sandbox
- `server.ts` — WebSocket server entry point

### @pulse-ide/frontend
- `electron/` — Electron main process
- `src/components/` — React components
- `src/hooks/` — Custom hooks (useWebSocket)
- `src/store/` — Zustand stores
