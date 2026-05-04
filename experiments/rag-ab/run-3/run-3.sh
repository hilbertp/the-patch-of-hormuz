#!/bin/bash
set -e
cd "$(dirname "$0")/../../.."
mkdir -p experiments/rag-ab/run-3

echo "=== Run: Ruflo Rom forced to use claude-flow tools ==="
time cat experiments/rag-ab/run-3/prompt.md | claude -p --output-format json --permission-mode bypassPermissions \
  --mcp-config experiments/rag-ab/mcp-ruflo.json \
  > experiments/rag-ab/run-3/run.json 2> experiments/rag-ab/run-3/run.stderr

echo "=== Done ==="
