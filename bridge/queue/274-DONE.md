---
id: "274"
title: "F-Bash-11 — Bashir lane states in Ops (replace coming-soon placeholder)"
from: rom
to: nog
status: DONE
slice_id: "274"
branch: "slice/274"
completed: "2026-05-01T10:12:00.000Z"
tokens_in: 85000
tokens_out: 12000
elapsed_ms: 540000
estimated_human_hours: 3.0
compaction_occurred: false
---

## Summary

Replaced the Bashir "coming soon" placeholder in the Post-Build Pipeline panel with a fully functional lane that mirrors Nog's lane structure. The lane renders four visual states driven by `branch-state.json.gate.status` and Bashir's heartbeat:

- **Idle** — `gate.status ∈ {IDLE, ACCUMULATING}`: Shows "Standing by — gate idle" empty card with bashir-idle-glyph, no live-dot. Displays last-run relative timestamp when available.
- **Authoring** — `GATE_RUNNING` without `tests-updated` phase: Active pill with live-dot, "Authoring tests from slice ACs" in check grid, elapsed timer running.
- **Running suite** — `GATE_RUNNING` with `phase === 'tests-updated'`: Authoring check flips to ✓, Running suite check shows ⏳.
- **Gate passed** — `IDLE` with recent `last_pass.ts` (< 60s): All checks ✓, "Result: pass", fades back to idle after 5s timer.
- **Gate failed** — `GATE_FAILED`: Error pill, failed batch retained, failure summary ("N ACs not met"). Persists until next gate-start.

### Heartbeat staleness

When `gate.status === GATE_RUNNING` and `bashir-heartbeat.json` age exceeds 90s (Worf's threshold), a warning badge renders: "Bashir · heartbeat stale" in `--warn` color. Heartbeat age is fetched from the existing `/api/gate-health` endpoint during GATE_RUNNING polls only.

### Event-driven transitions

Gate event handlers (`gate-start`, `tests-updated`, `regression-pass`, `regression-fail`, `gate-abort`) now trigger immediate `fetchBranchState()` calls with `_bashirLaneState` pre-set, giving sub-100ms visual transitions.

## Files changed

- `dashboard/lcars-dashboard.html` — Bashir lane CSS (mirroring Nog's structure), HTML structure (idle/running/failed states), `updateBashirLane()` + `setBashirCheck()` + `formatTimeAgo()` JS functions, gate event handler wiring, heartbeat fetch in `fetchBranchState()`
- `test/bashir-lane-idle.test.js` — 6 tests: IDLE/ACCUMULATING/null gate → idle, no live-dot
- `test/bashir-lane-authoring.test.js` — 4 tests: GATE_RUNNING without tests-updated → authoring
- `test/bashir-lane-running.test.js` — 4 tests: GATE_RUNNING with tests-updated → running
- `test/bashir-lane-passed.test.js` — 5 tests: IDLE + recent last_pass → passed, fade to idle
- `test/bashir-lane-failed.test.js` — 5 tests: GATE_FAILED → failed, persists, clears on next run
- `test/bashir-lane-heartbeat-stale.test.js` — 7 tests: >90s warning, threshold contract

## Test results

All 31 Bashir lane tests pass. Existing dashboard-render, gate-fail-step-card, and gate-abort tests pass with no regressions.

## Acceptance criteria verification

1. ✅ IDLE → idle state with "Standing by — gate idle" card, no live-dot
2. ✅ gate-start → authoring within ~100ms (event handler triggers immediate fetchBranchState)
3. ✅ tests-updated → running-suite state
4. ✅ regression-pass → gate-passed ~5s → fades to idle
5. ✅ regression-fail → gate-failed, persists until next gate-start
6. ✅ gate-abort → returns to idle
7. ✅ GATE_RUNNING + stale heartbeat (>90s) → warning badge
8. ✅ All six test files pass (31 total assertions)
9. ✅ No regression in existing tests
10. ✅ Changes only in dashboard/lcars-dashboard.html + 6 test files + DONE report
