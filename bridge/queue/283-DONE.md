---
id: "283"
title: "W-GateFlag-1 — DS9_USE_GATE_FLOW env flag (legacy direct-to-main vs gate flow)"
from: rom
to: nog
status: DONE
slice_id: "283"
branch: "slice/283"
completed: "2026-05-04T00:12:00.000Z"
tokens_in: 42000
tokens_out: 8500
elapsed_ms: 420000
estimated_human_hours: 1.0
compaction_occurred: false
---

## Summary

Added `DS9_USE_GATE_FLOW` env var flag to decouple "code path is loaded" from "code path is active" in `acceptAndMerge`. Default `0` preserves legacy direct-to-main merge behavior. Setting `1` activates the gate flow (squash to dev → Bashir → main).

## Changes

### `bridge/orchestrator.js`
- Wrapped the gate-flow logic in `acceptAndMerge` (L2980–3010) with a `DS9_USE_GATE_FLOW` check
- Flag `0`/unset → calls `mergeBranch(id, branchName, title)` (legacy direct-to-main)
- Flag `1` → runs `shouldDeferSquash()` check and `squashSliceToDev()` (gate flow)
- Flag is read per-call (`process.env` at invocation time), not at module load — allows live toggling without restart

### `.env.example`
- Added `DS9_USE_GATE_FLOW=0` with documentation comments explaining each value and when to flip

### `scripts/orch-start.sh`
- Added startup log showing active merge strategy (LEGACY vs GATE FLOW) based on env var

### `docs/runbooks/RUNBOOK-CLAUDE-AUTH.md`
- Appended "Switching merge strategy" section with flag documentation, flip instructions, and Bashir prerequisite

### `bridge/test/gate-flow-flag.test.js` (new)
- 6 tests covering both branches:
  1. `USE_GATE_FLOW` unset → legacy mergeBranch path
  2. `USE_GATE_FLOW=0` → legacy mergeBranch path
  3. `USE_GATE_FLOW=1` → gate-flow squashSliceToDev path
  4. `USE_GATE_FLOW=1` + gate running → defers slice
  5. `USE_GATE_FLOW=0` + gate running → ignores gate, takes legacy path
  6. Flag is read per-call, not at module load

## Test results

- `gate-flow-flag.test.js`: 6/6 pass
- `gate-recovery.test.js`: 15/15 pass (no regression)
- `history-pill-outcomes.test.js`: 6/6 pass (no regression)

## Acceptance criteria verification

1. ✅ `DS9_USE_GATE_FLOW=0` (or unset) → ACCEPTED slices land on main via legacy `mergeBranch`
2. ✅ `DS9_USE_GATE_FLOW=1` → ACCEPTED slices squash to dev via `squashSliceToDev`
3. ✅ `scripts/orch-start.sh` logs the active strategy at startup
4. ✅ `.env.example` documents the flag with default
5. ✅ `bridge/test/gate-flow-flag.test.js` passes both branches (6/6)
6. ✅ No existing test regresses
7. ✅ Default `0` means orchestrator restart keeps slices flowing to main as today
