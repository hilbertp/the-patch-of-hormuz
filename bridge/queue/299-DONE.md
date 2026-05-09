---
id: "299"
title: "F-Bashir-NonGate-1 — Non-gate Bashir invocation path"
from: rom
to: nog
status: DONE
slice_id: "299"
branch: "slice/299"
completed: "2026-05-09T12:45:00.000Z"
tokens_in: 95000
tokens_out: 12000
elapsed_ms: 1200000
estimated_human_hours: 3.0
compaction_occurred: false
---

## Summary

Added a non-gate Bashir invocation path to the orchestrator so commission-driven Bashir slices flow through the standard pipeline with full register-event coverage.

## Changes

### 1. new-slice.js: accept `--to bashir`

- Added `bashir` to `VALID_TO` array (`bridge/new-slice.js:77`)
- Updated usage/help text to show `rom|leeta|bashir`

### 2. Non-gate Bashir prompt template

- Created `bridge/templates/bashir-non-gate-prompt.md`
- Anchors Bashir on ROLE.md + slice body (no `{{SLICE_ACS}}`)
- Includes heartbeat contract (shared with gate path)
- Explicitly prohibits gate-specific actions: no `tests-updated` event, no `gate-telemetry.emit`, no regression suite work

### 3. Orchestrator dispatch: route Bashir slices

- Added `buildBashirNonGatePrompt()` — hydrates non-gate template with slice body + heartbeat path
- Added `invokeBashirNonGate()` — full lifecycle function mirroring `invokeRom`:
  - Creates worktree on `slice/{id}` branch
  - Acquires shared Bashir mutex before spawning
  - Spawns `claude -p` with non-gate prompt
  - Monitors heartbeat (30s poll, 90s stale threshold)
  - Inactivity timeout (default 60 min for Bashir, overridable via `timeout_min`)
  - On completion: copies DONE file, releases mutex, fires register events
  - On failure: writes ERROR file, releases mutex, fires error events
- Modified `dispatch()` to branch on `meta.to === 'bashir'` — routes to `invokeBashirNonGate` instead of `invokeRom`
- Default timeout for Bashir slices: 60 minutes (vs Rom's configurable inactivity default)

### 4. Register events (mirror Rom)

Non-gate Bashir dispatch fires these register events:
- `COMMISSIONED` (from existing `registerCommissioned` call in dispatch)
- `WORKTREE_CREATED`
- `LOCK_CLAIMED` / `LOCK_RELEASED` (for bashir_mutex)
- `BASHIR_INVOKED` (with `mode: 'non-gate'`)
- `DONE` (with `executor: 'bashir'`, `mode: 'non-gate'`)
- `STATE_FILES_ARCHIVED`
- `ERROR` (on failure paths)
- `SLICE_DEFERRED` (when mutex is held — returns to QUEUED for retry)

`BASHIR_TEST_NAMING_VIOLATION` fires only on gate runs (verified — non-gate path doesn't touch `_parseFailedAcs`).

### 5. Mutex design decision

**Shared mutex (safety-first default).** Both gate and non-gate paths use `gate-running.json` via `acquireGateMutex`/`releaseGateMutex`. Only one Bashir invocation runs at a time, regardless of mode. If the mutex is held when a non-gate slice dispatches, it returns to QUEUED with a `SLICE_DEFERRED` event and retries on the next poll.

Rationale: Bashir's heartbeat, timeout, and state-file contracts are designed for a single concurrent instance. Separate mutexes would require changes to heartbeat polling and risk state corruption if both paths write to the same heartbeat file. The shared mutex is the safe default per brief constraints.

### 6. Gate-flow isolation verification

The non-gate path does NOT:
- Touch `branch-state.json` gate state (no `GATE_RUNNING`, no `gate.current_run`)
- Emit gate telemetry (`gate-start`, `gate-abort`, `regression-pass/fail`)
- Trigger `_gateTestsUpdated` or `_gateAbort`
- Reference the regression suite
- Call `emitGateTelemetry`

## Tests

### New tests (19 assertions, all passing)

**`test/new-slice-bashir-target.test.js`** (5 tests):
- `--to bashir` creates STAGED file with correct frontmatter
- Invalid `--to` target rejected
- `--body-file` included in staged file
- `--timeout` sets `timeout_min`
- `--depends-on` sets `depends_on`

**`test/bashir-non-gate-dispatch.test.js`** (8 tests):
- Template file exists
- Prompt hydrates slice body
- Prompt hydrates heartbeat path
- No gate-specific scaffolding
- Mode instructions present
- Non-gate differs from gate template
- Default timeout is 60 minutes
- Template path constant correct

**`test/bashir-non-gate-mutex.test.js`** (6 tests):
- Acquire succeeds when no mutex held
- Second acquire fails (shared mutex)
- `shouldDeferSquash` true when held
- Release then re-acquire works
- `shouldDeferSquash` false when not held
- Concurrent gate + non-gate: second waits

### Existing tests (all passing)

All Bashir gate tests pass unchanged:
- `bashir-invocation-spawn.test.js` (8/8)
- `bashir-crash-recovery.test.js` (7/7)
- `bashir-lane-*.test.js` (all passing)
- `state-gate-mutex.test.js` (9/9)
- `orchestrator-validation.test.js` (14/14)
- `new-slice-restage*.test.js` (all passing)

Note: 2 pre-existing failures (`bashir-tests-updated.test.js:1`, `lifecycle-events.test.js:1`) reproduce identically on `main` — not caused by this slice.

## Acceptance criteria status

1. **`node bridge/new-slice.js --to bashir ...` writes well-formed frontmatter** — PASS
2. **Orchestrator dispatches `to: bashir` through non-gate path with register events** — PASS
3. **Non-gate prompt anchors on ROLE.md + slice body, no gate scaffolding** — PASS
4. **Mutex prevents concurrent gate + non-gate** — PASS
5. **All new tests pass; existing gate tests pass** — PASS
6. **DONE report has standard Rom-equivalent fields** — PASS (from/to/status/slice_id/branch/completed/tokens_in/tokens_out/elapsed_ms/estimated_human_hours/compaction_occurred)
7. **Changes only in orchestrator.js, new-slice.js, templates/, test/** — PASS
