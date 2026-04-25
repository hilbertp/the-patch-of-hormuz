#!/usr/bin/env bash
# start.sh — Native launcher for Liberation of Bajor (orchestrator + dashboard).
#
# Starts node dashboard/server.js and node bridge/orchestrator.js as background
# processes, writes PIDs to bridge/.run.pid, and tails startup to stdout.
#
# Usage:  ./scripts/start.sh
#   To override repo root:  REPO_ROOT=/path/to/repo ./scripts/start.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="${REPO_ROOT:-$(dirname "$SCRIPT_DIR")}"

# ── Prerequisites ─────────────────────────────────────────────────────────────

if ! command -v node &>/dev/null; then
  echo "ERROR: node not found. Install Node.js >= 20." >&2
  exit 1
fi

NODE_MAJOR="$(node --version | sed 's/^v//' | cut -d. -f1)"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "ERROR: Node.js >= 20 required (found $(node --version))." >&2
  exit 1
fi

if ! command -v claude &>/dev/null; then
  echo "ERROR: claude CLI not found. Install @anthropic-ai/claude-code globally." >&2
  exit 1
fi

if [ ! -d "$REPO_ROOT/bridge" ] || [ ! -d "$REPO_ROOT/dashboard" ]; then
  echo "ERROR: Must run from repo root (bridge/ and dashboard/ not found at $REPO_ROOT)." >&2
  exit 1
fi

# ── Port check ────────────────────────────────────────────────────────────────

if command -v lsof &>/dev/null && lsof -iTCP:4747 -sTCP:LISTEN &>/dev/null; then
  echo "ERROR: Port 4747 is already in use. Stop the existing process first." >&2
  exit 1
fi

PID_FILE="$REPO_ROOT/bridge/.run.pid"
if [ -f "$PID_FILE" ]; then
  any_alive=0
  while IFS= read -r pid; do
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      any_alive=1
      break
    fi
  done < "$PID_FILE"
  if [ "$any_alive" -eq 1 ]; then
    echo "WARNING: $PID_FILE exists and a recorded process is still running." >&2
    echo "         Run ./scripts/stop.sh first." >&2
    exit 1
  fi
  # All recorded PIDs are dead — stale file from a prior crash; safe to remove.
  rm -f "$PID_FILE"
fi

# ── Launch ────────────────────────────────────────────────────────────────────

DASHBOARD_LOG="$REPO_ROOT/bridge/dashboard.log"
ORCHESTRATOR_LOG="$REPO_ROOT/bridge/orchestrator.log"

echo "Starting LCARS dashboard server..."
node "$REPO_ROOT/dashboard/server.js" \
  >>"$DASHBOARD_LOG" 2>&1 &
DASHBOARD_PID=$!

echo "Starting relay orchestrator..."
node "$REPO_ROOT/bridge/orchestrator.js" \
  >>"$ORCHESTRATOR_LOG" 2>&1 &
ORCHESTRATOR_PID=$!

# Write PID file (dashboard PID on line 1, orchestrator PID on line 2)
printf '%s\n%s\n' "$DASHBOARD_PID" "$ORCHESTRATOR_PID" > "$PID_FILE"

echo ""
echo "Liberation of Bajor — native launch"
echo "  Dashboard:     http://localhost:4747"
echo "  Dashboard log: $DASHBOARD_LOG"
echo "  Orchestrator:  PID $ORCHESTRATOR_PID"
echo "  Orch log:      $ORCHESTRATOR_LOG"
echo "  PID file:      $PID_FILE"
echo ""
echo "To stop:  ./scripts/stop.sh"
