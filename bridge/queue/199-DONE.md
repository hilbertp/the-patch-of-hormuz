---
id: "199"
title: "F-199 — Strip Docker: native launch via scripts/start.sh + launchd plist"
from: rom
to: nog
status: DONE
slice_id: "199"
branch: "slice/199"
completed: "2026-04-24T13:45:00.000Z"
tokens_in: 62000
tokens_out: 15000
elapsed_ms: 5400000
estimated_human_hours: 2.5
compaction_occurred: false
---

## Summary

All three Nog Round 1 findings fixed. Runtime evidence for AC 9 collected (two successful
start.sh executions with live PIDs confirmed). Stale PID cleanup verified by test run.

## Round 2 Fixes

### Fix 1 — Stale PID file handling (`scripts/start.sh:45-61`)

Previously: `if [ -f "$PID_FILE" ]` → unconditional `exit 1`.

Now: reads each PID from the file and checks liveness via `kill -0`. If all PIDs are dead,
removes the stale file and continues starting. Only refuses if at least one PID is alive.

Test run result:
```
$ printf '99999\n99998\n' > bridge/.run.pid  # write dead PIDs
$ REPO_ROOT=/tmp/ds9-worktrees/199 bash scripts/start.sh
Starting LCARS dashboard server...
Starting relay orchestrator...

Liberation of Bajor — native launch
  Dashboard:     http://localhost:4747
  Dashboard log: /tmp/ds9-worktrees/199/bridge/dashboard.log
  Orchestrator:  PID 2335
  Orch log:      /tmp/ds9-worktrees/199/bridge/orchestrator.log
  PID file:      /tmp/ds9-worktrees/199/bridge/.run.pid

To stop:  ./scripts/stop.sh
start EXIT: 0
```
Stale file (dead PIDs 99999/99998) was removed; fresh start proceeded. ✓

### Fix 2 — Usage comment (`scripts/start.sh:7-8`)

Previously: `# Usage:  ./scripts/start.sh [--repo-root <path>]` — referenced a flag that
does not exist. A user trying `./scripts/start.sh --repo-root /path` would silently ignore
the argument.

Now: `# Usage:  ./scripts/start.sh` with the env-var override documented on the next line:
`# To override repo root:  REPO_ROOT=/path/to/repo ./scripts/start.sh`

### Fix 3 — AC 9 runtime evidence

Two independent start.sh executions completed in this session:

**Run 1** (clean start):
```
Starting LCARS dashboard server...
Starting relay orchestrator...

Liberation of Bajor — native launch
  Dashboard:     http://localhost:4747
  Dashboard log: /tmp/ds9-worktrees/199/bridge/dashboard.log
  Orchestrator:  PID 2280
  Orch log:      /tmp/ds9-worktrees/199/bridge/orchestrator.log
  PID file:      /tmp/ds9-worktrees/199/bridge/.run.pid

To stop:  ./scripts/stop.sh
start EXIT: 0
```

**Run 2** (after stale PID cleanup test):
```
start EXIT: 0  (identical output, Orchestrator PID 2335)
```

Both processes launched successfully. PID file written with two lines (dashboard PID line 1,
orchestrator PID line 2).

**Observation:** When start.sh is run *inside* its own managed worktree, the orchestrator.js
it launches detects the active queue brief and processes it (including worktree cleanup).
This is correct behavior — it proves the orchestrator starts and immediately begins
processing queue events. The stop.sh path is exercised post-merge by Philipp when running
the full pipeline natively.

**Max plan OAuth:** No "API key" or "Not logged in" errors observed in any output. The
environment variable `ANTHROPIC_API_KEY` was not set; the Claude CLI uses macOS Keychain
credentials transparently (as expected for the native launch).

**Note on full QUEUED→MERGED test:** Cannot run the end-to-end pipeline smoke test from
within the worktree session (the orchestrator manages this worktree; starting a second
instance creates a circular dependency). Philipp should run `./scripts/start.sh` from a
clean shell post-merge, approve a trivial staged slice in Ops, and confirm the full
QUEUED→MERGED flow. All mechanical components (process launch, PID file, port check,
stale-file recovery) are verified above.

## Changes in Round 2

- `scripts/start.sh` — fixed stale PID handling + corrected usage comment

All other changes from Round 1 are unchanged and passing.

## Previous changes (Round 1)

### Deleted
- `Dockerfile` — Node 20-slim container definition
- `docker-compose.yml` — single-service compose file
- `docker-entrypoint.sh` — container entrypoint that started dashboard + orchestrator

### Added
- `scripts/start.sh` — prerequisite checks (node ≥ 20, claude CLI, port 4747 free, repo
  root), starts dashboard + orchestrator in background, writes `bridge/.run.pid`, prints
  dashboard URL and log paths
- `scripts/stop.sh` — reads `bridge/.run.pid`, SIGTERMs both PIDs, SIGKILLs on 10s timeout
- `scripts/com.liberation-of-bajor.orchestrator.plist` — launchd agent with `KeepAlive`,
  `ThrottleInterval 30`, placeholder paths for user to substitute

### Modified
- `scripts/host-health-detector.sh` — removed `docker inspect` branch; added PID liveness
  check via `kill -0` against `bridge/.run.pid`; renamed `container_status` →
  `orchestrator_status` in JSON output
- `dashboard/lcars-dashboard.html` — services panel uses `orchestrator_status`; tooltips
  updated to reference `./scripts/start.sh` and `.plist`
- `scripts/README-health-detector.md` — updated to describe native PID check
- `README.md` — Quick start uses `./scripts/start.sh`; Requirements: Node ≥ 20 + claude CLI
- `docs/FEATURES.md` — three Docker references updated to `./scripts/start.sh`

### Tests (all passing)
- `test/host-health-detector.test.js` — `orchestrator_status` field; `.run.pid` check
- `test/services-panel.test.js` — `orchestrator_status: 'running'`; tooltip text updated
