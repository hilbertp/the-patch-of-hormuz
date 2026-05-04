#!/bin/bash
# Reproduction script: run claude -p with Ruflo MCP config 5 times
# Check if claude-flow tools register or stay "still connecting"
set -e
cd "$(dirname "$0")/../.."
EXPDIR="experiments/ruflo-fix-1"
mkdir -p "$EXPDIR/runs"

PROMPT="List all available MCP tools that start with 'mcp__'. If none are available, say 'NO MCP TOOLS AVAILABLE'. Be concise."

for i in 1 2 3 4 5; do
  echo "=== Run $i of 5 ==="
  START_MS=$(($(date +%s) * 1000))

  echo "$PROMPT" | claude -p --output-format json --permission-mode bypassPermissions \
    --mcp-config experiments/rag-ab/mcp-ruflo.json \
    > "$EXPDIR/runs/run-$i.json" 2> "$EXPDIR/runs/run-$i.stderr" || true

  END_MS=$(($(date +%s) * 1000))
  ELAPSED=$(( END_MS - START_MS ))

  # Check if any mcp__ tools appeared in the result
  if grep -q "mcp__" "$EXPDIR/runs/run-$i.json" 2>/dev/null; then
    echo "  Result: TOOLS LOADED (${ELAPSED}ms)"
  else
    echo "  Result: NO TOOLS (${ELAPSED}ms)"
  fi

  echo "  Stderr: $(wc -c < "$EXPDIR/runs/run-$i.stderr") bytes"
  echo ""
done

echo "=== Summary ==="
for i in 1 2 3 4 5; do
  if grep -q "mcp__" "$EXPDIR/runs/run-$i.json" 2>/dev/null; then
    echo "Run $i: TOOLS LOADED"
  else
    echo "Run $i: NO TOOLS"
  fi
done
