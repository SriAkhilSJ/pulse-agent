# Getting Started

## Prerequisites

- Rust 1.79+ ([rustup](https://rustup.rs/))
- Python 3.12+ ([python.org](https://python.org/))
- Node.js 20+ ([nodejs.org](https://nodejs.org/))

## Quick Start

```bash
# Clone the repository
git clone https://github.com/surpassing/surpassing.git
cd surpassing

# Build the Rust workspace
cargo build

# Install Python dependencies
pip install -e "python/[dev]"

# Install TypeScript dependencies
npm ci

# Run tests
cargo test --all
pytest python/ -v
npm test
```

## Running the Agent

```bash
# Build and run the agent
cargo run --bin surpassing -- --acp --stdio
```
