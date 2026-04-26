#!/usr/bin/env bash
# stop.sh — Stop Liberation of Bajor processes started by scripts/start.sh.
#
# Reads bridge/.run.pid, SIGTERMs both PIDs, waits up to 10 seconds, then
# SIGKILLs any that haven't exited. Removes the PID file on success.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="${REPO_ROOT:-$(dirname "$SCRIPT_DIR")}"
PID_FILE="$REPO_ROOT/bridge/.run.pid"
KILL_TIMEOUT=10

if [ ! -f "$PID_FILE" ]; then
  echo "No PID file at $PID_FILE — nothing to stop." >&2
  exit 0
fi

PIDS=()
while IFS= read -r line; do
  PIDS+=("$line")
done < "$PID_FILE"
if [ "${#PIDS[@]}" -lt 2 ]; then
  echo "ERROR: PID file malformed (expected 2 lines)." >&2
  exit 1
fi

DASHBOARD_PID="${PIDS[0]}"
ORCHESTRATOR_PID="${PIDS[1]}"

stop_pid() {
  local pid="$1" name="$2"
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "  $name (PID $pid): already stopped"
    return
  fi
  echo "  Sending SIGTERM to $name (PID $pid)..."
  kill -TERM "$pid" 2>/dev/null || true
  local elapsed=0
  while kill -0 "$pid" 2>/dev/null && [ "$elapsed" -lt "$KILL_TIMEOUT" ]; do
    sleep 1
    elapsed=$((elapsed + 1))
  done
  if kill -0 "$pid" 2>/dev/null; then
    echo "  $name did not exit in ${KILL_TIMEOUT}s — sending SIGKILL."
    kill -KILL "$pid" 2>/dev/null || true
  else
    echo "  $name stopped."
  fi
}

echo "Stopping Liberation of Bajor..."
stop_pid "$DASHBOARD_PID"    "dashboard"
stop_pid "$ORCHESTRATOR_PID" "orchestrator"

rm -f "$PID_FILE"
echo "Done."
