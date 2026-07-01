# Contributing

## Code Standards

- Rust: `cargo clippy -- -D warnings` must pass
- Python: `ruff check .` and `ruff format .` must pass
- TypeScript: strict mode, no `any`

## Commit Convention

```
type: concise subject line

Types: feat, fix, refactor, docs, test, chore
```

## Pull Request Process

1. Create a feature branch
2. Implement with tests
3. Run all checks locally
4. Open PR with description
5. CI must pass
6. Code review approval
