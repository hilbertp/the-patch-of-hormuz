#!/bin/bash
set -e
cd "$(dirname "$0")/../.."
PROMPT="$(cat experiments/rag-ab/prompt.md)"
EXPDIR="experiments/rag-ab"

echo "=== Run A: base Rom (no Ruflo MCP) ==="
time echo "$PROMPT" | claude -p --output-format json --permission-mode bypassPermissions \
  --mcp-config experiments/rag-ab/mcp-base.json \
  > "$EXPDIR/run-a-base.json" 2> "$EXPDIR/run-a-base.stderr" || true

# Capture Run A output files
echo "=== Capturing Run A outputs ==="
if [ -f bridge/state/gate-history.js ]; then
  cp bridge/state/gate-history.js "$EXPDIR/run-a-output.js"
  rm bridge/state/gate-history.js
  echo "  captured gate-history.js -> run-a-output.js"
else
  echo "  WARNING: bridge/state/gate-history.js not found after Run A"
fi

if [ -f bridge/test/state-gate-history.test.js ]; then
  cp bridge/test/state-gate-history.test.js "$EXPDIR/run-a-output.test.js"
  rm bridge/test/state-gate-history.test.js
  echo "  captured test -> run-a-output.test.js"
else
  echo "  WARNING: bridge/test/state-gate-history.test.js not found after Run A"
fi

# Reset any other changes Run A may have made
git checkout -- . 2>/dev/null || true
git clean -fd bridge/state/ bridge/test/ 2>/dev/null || true

echo ""
echo "=== Run B: Ruflo-augmented Rom ==="
time echo "$PROMPT" | claude -p --output-format json --permission-mode bypassPermissions \
  --mcp-config experiments/rag-ab/mcp-ruflo.json \
  > "$EXPDIR/run-b-ruflo.json" 2> "$EXPDIR/run-b-ruflo.stderr" || true

# Capture Run B output files
echo "=== Capturing Run B outputs ==="
if [ -f bridge/state/gate-history.js ]; then
  cp bridge/state/gate-history.js "$EXPDIR/run-b-output.js"
  rm bridge/state/gate-history.js
  echo "  captured gate-history.js -> run-b-output.js"
else
  echo "  WARNING: bridge/state/gate-history.js not found after Run B"
fi

if [ -f bridge/test/state-gate-history.test.js ]; then
  cp bridge/test/state-gate-history.test.js "$EXPDIR/run-b-output.test.js"
  rm bridge/test/state-gate-history.test.js
  echo "  captured test -> run-b-output.test.js"
else
  echo "  WARNING: bridge/test/state-gate-history.test.js not found after Run B"
fi

# Final cleanup
git checkout -- . 2>/dev/null || true
git clean -fd bridge/state/ bridge/test/ 2>/dev/null || true

echo ""
echo "=== Done. Outputs in $EXPDIR/ ==="
ls -la "$EXPDIR"/run-*
