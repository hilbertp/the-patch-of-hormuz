---
id: "267"
title: "F-Bash-5 — Bashir invocation harness (claude -p, AC-blind)"
from: rom
to: nog
status: DONE
slice_id: "267"
branch: "slice/267"
completed: "2026-04-30T15:12:00.000Z"
tokens_in: 82000
tokens_out: 14000
elapsed_ms: 420000
estimated_human_hours: 3.5
compaction_occurred: false
---

## Summary

Replaced slice 265's placeholder gate with a real Bashir invocation harness. When the merge button fires `gate-start`, the orchestrator now spawns Bashir headless via `claude -p --permission-mode bypassPermissions`, passing a structured prompt containing the slice ACs of all unmerged-on-dev slices.

## Changes

### 1. Bashir prompt template (`bridge/templates/bashir-prompt.md`)

New template file hydrated per-run with:
- Reference to `roles/bashir/ROLE.md`
- Mutex contract and heartbeat path
- Regression suite path (`regression/`)
- AC-blind constraint (no diffs, no product code)
- Unmerged slice ACs (extracted from DONE files)
- Output contract: `tests-updated` only, no suite execution

### 2. Real Bashir spawn in `startGate()` (`bridge/orchestrator.js`)

Replaced the 1-second placeholder timeout with:

- **`buildBashirPrompt(branchState)`** — reads `branch-state.json.dev.commits[]`, extracts slice IDs from commit subjects `(slice NNN)`, reads each slice's DONE/ACCEPTED/PARKED/ARCHIVED file, extracts the Acceptance Criteria block, and hydrates the prompt template.
- **Bashir spawn** — `claude -p --permission-mode bypassPermissions` with `cwd: PROJECT_DIR` (main repo, not a worktree). Prompt piped via stdin. Stdout captured to `bridge/state/bashir-stdout.log`.
- **Heartbeat polling** — every 30s, checks `bridge/state/bashir-heartbeat.json`. If stale > 90s, kills Bashir and emits `gate-abort`.
- **Absolute timeout** — 10 minutes. Kills Bashir and emits `gate-abort` if exceeded.
- **On `tests-updated`** — emits placeholder `regression-fail` (reason: `suite-not-yet-executed`), updates `branch-state.gate` to `GATE_FAILED`, releases mutex.
- **On crash/timeout/no event** — emits `gate-abort`, sets `gate.status = GATE_ABORTED`, releases mutex.

New exports for testing: `buildBashirPrompt`, `_gateTestsUpdated`, `_gateAbort`, `_checkForEvent`, and heartbeat/timeout constants.

### 3. Tests

- **`test/bashir-invocation-spawn.test.js`** (8 tests) — verifies prompt construction: AC extraction from DONE files, heartbeat path hydration, AC-blind constraint, missing slice handling, empty commits, template content.
- **`test/bashir-tests-updated.test.js`** (5 tests) — verifies `tests-updated` path: regression-fail emission, branch-state transition to GATE_FAILED, mutex release, event scanning.
- **`test/bashir-crash-recovery.test.js`** (7 tests) — verifies abort path: gate-abort emission for each reason (heartbeat_stale, bashir_crash, timeout, no_tests_updated), branch-state to GATE_ABORTED, mutex release, telemetry routing.

All 20 new tests pass. Existing `state-gate-mutex.test.js` (9 tests) continues to pass.

## AC Verification

1. **Merge with commits ahead spawns `claude -p`** — `startGate()` calls `execFile('claude', ['-p', '--permission-mode', 'bypassPermissions'])` and writes stdout to `bridge/state/bashir-stdout.log`. ✓
2. **Prompt contains unmerged slice ACs** — `buildBashirPrompt()` reads DONE files for all commit subjects matching `(slice N)`. Tested. ✓
3. **Bashir creates `regression/` on first run** — prompt template instructs: "If `regression/` does not exist, create it." ✓
4. **On `tests-updated`, emit placeholder `regression-fail` and release mutex** — `_gateTestsUpdated()` does exactly this. Tested. ✓
5. **Heartbeat stale > 90s → `gate-abort` and release mutex** — heartbeat poll at 30s intervals, 90s threshold. `_gateAbort()` tested. ✓
6. **All gate events through `gate-telemetry.emit`** — no direct register writes in this slice's code. Tested. ✓
7. **Worf's gate-recovery tests pass** — `state-gate-mutex.test.js` (9/9) passes. ✓
8. **Three new test files pass** — 20/20 tests pass. ✓

## Constraints adherence

- All gate events through `gate-telemetry.emit` — verified.
- `writeJsonAtomic` for branch-state changes — used throughout.
- Bashir is AC-blind — prompt contains only ACs, no diffs or product code.
- Heartbeat is authoritative for liveness — PID is diagnostic only.
- Did not modify `bridge/state/*` modules.
- Did not modify `roles/bashir/ROLE.md`.
