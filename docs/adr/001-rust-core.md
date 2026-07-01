# ADR-001: Rust as Core Engine Language

## Status: Accepted

## Context
The core engine needs to handle real-time file watching, AST parsing, and knowledge graph queries with sub-100ms latency. We need a language with zero-cost abstractions and strong async support.

## Decision
Use Rust as the core engine language, with tokio for async runtime.

## Consequences
- Excellent performance for hot paths
- Strong type system prevents runtime errors
- Steeper learning curve for contributors
- Longer compile times

## Alternatives Considered
- **Go**: Good concurrency, but GC pauses unacceptable for <50ms targets
- **C++**: Maximum performance, but safety concerns and slower development
- **Zig**: Promising but ecosystem too immature
