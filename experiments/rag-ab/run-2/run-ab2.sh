#!/bin/bash
set -e
cd "$(dirname "$0")/../../.."
PROMPT_FILE=experiments/rag-ab/run-2/prompt.md
mkdir -p experiments/rag-ab/run-2

echo "=== Run A: base Rom (no Ruflo MCP) ==="
PROMPT=$(sed 's/{base|ruflo}/base/g' "$PROMPT_FILE")
time claude -p --output-format json --permission-mode bypassPermissions \
  --mcp-config experiments/rag-ab/mcp-base.json \
  "$PROMPT" > experiments/rag-ab/run-2/run-a-base.json 2> experiments/rag-ab/run-2/run-a-base.stderr

echo "=== Run B: Ruflo-augmented Rom ==="
PROMPT=$(sed 's/{base|ruflo}/ruflo/g' "$PROMPT_FILE")
time claude -p --output-format json --permission-mode bypassPermissions \
  --mcp-config experiments/rag-ab/mcp-ruflo.json \
  "$PROMPT" > experiments/rag-ab/run-2/run-b-ruflo.json 2> experiments/rag-ab/run-2/run-b-ruflo.stderr

echo "=== Done ==="
