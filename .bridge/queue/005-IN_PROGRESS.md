---
id: "005"
title: "Fix — Human-readable watcher stdout"
from: mara
to: rook
priority: normal
created: "2026-04-06T00:00:00Z"
references: null
timeout_min: 10
---

## Objective

Make the watcher's terminal output human-readable. Right now stdout emits raw JSON lines — useful for machines, painful for humans watching the terminal. The log file (bridge.log) must stay as JSON. Only stdout changes.

---

## Context

The watcher's `log()` function currently writes the same JSON line to both `bridge.log` and stdout. Philipp watches the terminal while the watcher runs and wants to see at a glance what's happening — not parse JSON mentally.

**Constraint: bridge.log stays JSON.** The file format must not change — it's the machine-readable audit trail. Only the stdout mirror changes.

---

## Tasks

### Branch

1. Create branch `fix/readable-stdout` from `main`.

### Change stdout format in `log()`

2. Update the `log()` function in `.bridge/watcher.js` so that:
   - `bridge.log` continues to receive the exact same JSON line as today (no change)
   - `stdout` receives a human-readable line instead

   **Target stdout format:**

   ```
   [Bridge] 23:53:57  startup    Watcher started
   [Bridge] 23:53:57  startup    Crash recovery: stub (Layer 3, not implemented)
   [Bridge] 23:53:57  pickup     004  Commission picked up (004-PENDING.md)
   [Bridge] 23:53:57  state      004  PENDING → IN_PROGRESS
   [Bridge] 23:53:57  invoke     004  claude -p started (timeout: 15min)
   [Bridge] 23:56:12  complete   004  Done in 2m 14s ✓
   [Bridge] 23:56:12  state      004  IN_PROGRESS → DONE
   ```

   **Format rules:**
   - Prefix: `[Bridge]`
   - Timestamp: local time, `HH:MM:SS` only (no date, no UTC — this is a live terminal, not a log)
   - Event name: left-padded/fixed-width column (8 chars) for alignment
   - Commission ID: shown when present, omitted when not (startup lines have no ID)
   - Message: human-readable summary extracted from the fields — not a JSON dump
   - For `complete` events: include duration in `Xm Ys` format and a `✓` or `✗` depending on success/failure
   - For `state` events: show `FROM → TO` (e.g. `PENDING → IN_PROGRESS`)
   - For `error`/`timeout` events: prefix with `✗` and include exit code or "timed out"
   - For `heartbeat` events (if logged to stdout at all): omit entirely — too noisy

   **Implementation note:** The cleanest approach is a separate `formatForStdout(level, event, fields)` function that `log()` calls for its stdout write. This keeps the JSON serialisation and the human formatting separate and easy to adjust.

### Commit

3. Commit on `fix/readable-stdout`:
   - `git add .bridge/watcher.js`
   - `git commit -m "fix: human-readable stdout for watcher (bridge.log stays JSON)"`
   - Then commit queue files:
   - `git add .bridge/queue/`
   - `git commit -m "chore: commit queue files for commission 005"`

---

## Constraints

- `bridge.log` format must not change — every line must remain a valid JSON object
- No new dependencies
- Do not touch any other files

---

## Success criteria

1. `bridge.log` still contains valid JSON lines (unchanged format)
2. Stdout is human-readable — Philipp can watch the terminal and understand what's happening without parsing JSON
3. `complete` events show duration and ✓/✗
4. `state` events show `FROM → TO`
5. `error`/`timeout` events are clearly marked
6. Heartbeat events suppressed from stdout (not from bridge.log)
7. All committed on `fix/readable-stdout`
8. Report at `.bridge/queue/005-DONE.md`
