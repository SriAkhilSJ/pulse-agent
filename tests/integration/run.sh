#!/usr/bin/env bash
# Integration test runner for Surpassing IDE Agent
set -euo pipefail

echo "=== Surpassing Integration Tests ==="

# Check that the agent binary exists
if [ ! -f "./target/release/surpassing" ]; then
    echo "ERROR: surpassing binary not found. Run 'cargo build --release' first."
    exit 1
fi

# Test 1: Agent starts and responds to initialize
echo "Test 1: Agent initialize..."
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' | ./target/release/surpassing --acp --stdio | head -1
echo "PASS"

# Test 2: Python agents import correctly
echo "Test 2: Python imports..."
python -c "from hermes_agents import BaseAgent; print('PASS')"

# Test 3: VS Code extension compiles
echo "Test 3: TypeScript compile..."
cd adapters/vscode && npm run compile && cd ../..
echo "PASS"

echo "=== All integration tests passed ==="
