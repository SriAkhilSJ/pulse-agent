# Agent Client Protocol (ACP)

ACP is a JSON-RPC 2.0 protocol over stdio for communication between IDE adapters and the agent.

## Methods

| Method | Direction | Description |
|--------|-----------|-------------|
| `initialize` | Client → Agent | Handshake and capability negotiation |
| `chat/message` | Client → Agent | Send a chat message |
| `chat/response` | Agent → Client | Agent response |
| `surpassing/explain` | Client → Agent | Explain selected code |
| `surpassing/generateTests` | Client → Agent | Generate tests for file |
| `surpassing/refactor` | Client → Agent | Smart refactor of selection |
