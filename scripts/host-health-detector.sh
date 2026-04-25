#!/usr/bin/env bash
# host-health-detector.sh — Native process health detector for Liberation of Bajor
#
# Polls orchestrator PID liveness (bridge/.run.pid) + dashboard /api/health
# every 10 seconds. Writes bridge/host-health.json atomically.
# Emits macOS notification on sustained downtime (>30s).
# Logs state changes to bridge/host-health.log.
#
# bridge/host-health.json schema:
#   orchestrator_status  "running" | "stopped" — both PIDs alive per kill -0
#   api_status           "ok" | "error" — HTTP 200 from /api/health
#   last_checked         ISO 8601 UTC timestamp
#   consecutive_failures integer — incremented each poll where not fully healthy
#
# Usage: ./scripts/host-health-detector.sh [REPO_ROOT]
#   REPO_ROOT defaults to the parent directory of this script's location.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="${1:-$(dirname "$SCRIPT_DIR")}"
HEALTH_FILE="$REPO_ROOT/bridge/host-health.json"
HEALTH_TMP="$REPO_ROOT/bridge/.host-health.json.tmp"
LOG_FILE="$REPO_ROOT/bridge/host-health.log"
PID_FILE="$REPO_ROOT/bridge/.run.pid"

POLL_INTERVAL=10
NOTIFICATION_THRESHOLD=30  # seconds of sustained failure before notification
API_TIMEOUT=3
API_URL="http://localhost:4747/api/health"

# State tracking
prev_orchestrator_status=""
prev_api_status=""
consecutive_failures=0
failure_start_ts=0
notification_sent=0

log_change() {
  local msg="$1"
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $msg" >> "$LOG_FILE"
}

write_status() {
  local orchestrator_status="$1"
  local api_status="$2"
  local now
  now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  cat > "$HEALTH_TMP" <<ENDJSON
{
  "orchestrator_status": "$orchestrator_status",
  "api_status": "$api_status",
  "last_checked": "$now",
  "consecutive_failures": $consecutive_failures
}
ENDJSON
  mv -f "$HEALTH_TMP" "$HEALTH_FILE"
}

check_orchestrator() {
  if [ ! -f "$PID_FILE" ]; then
    echo "stopped"
    return
  fi
  mapfile -t pids < "$PID_FILE"
  local all_alive=true
  for pid in "${pids[@]}"; do
    pid="${pid// /}"  # trim whitespace
    if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then
      all_alive=false
      break
    fi
  done
  if $all_alive && [ "${#pids[@]}" -ge 2 ]; then
    echo "running"
  else
    echo "stopped"
  fi
}

check_api() {
  local http_code
  http_code="$(curl -s -o /dev/null -w '%{http_code}' --max-time "$API_TIMEOUT" "$API_URL" 2>/dev/null)" || {
    echo "error"
    return
  }
  if [ "$http_code" = "200" ]; then
    echo "ok"
  else
    echo "error"
  fi
}

is_healthy() {
  [ "$1" = "running" ] && [ "$2" = "ok" ]
}

send_notification() {
  osascript -e 'display notification "Orchestrator or API is unreachable. Run ./scripts/start.sh." with title "Liberation of Bajor — service down"' 2>/dev/null || true
}

# Main loop
while true; do
  orchestrator_status="$(check_orchestrator)"
  api_status="$(check_api)"

  # Track failures
  if is_healthy "$orchestrator_status" "$api_status"; then
    consecutive_failures=0
    failure_start_ts=0
    notification_sent=0
  else
    consecutive_failures=$((consecutive_failures + 1))
    if [ "$failure_start_ts" -eq 0 ]; then
      failure_start_ts="$(date +%s)"
    fi
  fi

  # Write status atomically
  write_status "$orchestrator_status" "$api_status"

  # Log state changes
  if [ "$orchestrator_status" != "$prev_orchestrator_status" ] || [ "$api_status" != "$prev_api_status" ]; then
    log_change "orchestrator=$orchestrator_status api=$api_status failures=$consecutive_failures"
    prev_orchestrator_status="$orchestrator_status"
    prev_api_status="$api_status"
  fi

  # macOS notification on sustained downtime (>30s)
  if [ "$failure_start_ts" -ne 0 ] && [ "$notification_sent" -eq 0 ]; then
    now_ts="$(date +%s)"
    elapsed=$((now_ts - failure_start_ts))
    if [ "$elapsed" -ge "$NOTIFICATION_THRESHOLD" ]; then
      send_notification
      notification_sent=1
      log_change "NOTIFICATION: service down for ${elapsed}s"
    fi
  fi

  sleep "$POLL_INTERVAL"
done
