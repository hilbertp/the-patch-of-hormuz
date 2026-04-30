---
id: "270"
title: "F-Bash-8 — Nog telemetry + RR computation + RR pill"
from: rom
to: nog
status: DONE
slice_id: "270"
branch: "slice/270"
completed: "2026-04-30T20:45:00.000Z"
tokens_in: 185000
tokens_out: 18000
elapsed_ms: 1200000
estimated_human_hours: 4.0
compaction_occurred: false
---

## Summary

Implemented the three-part Regression Risk (RR) metric system: Nog telemetry emission, RR computation engine, and RR pill rendering in the Branch Topology panel.

## What was done

### 1. Nog telemetry hook (`bridge/state/gate-telemetry.js` + `bridge/orchestrator.js`)

- Added `NOG_TELEMETRY` to `VALID_EVENTS` in gate-telemetry.js.
- In the orchestrator's ACCEPTED verdict path, after `appendRoundEntry` but before `handleAccepted`, emits `NOG_TELEMETRY` via `emitGateTelemetry()` with all 7 fields:
  - `slice_id`, `rounds`, `files_touched`, `high_risk_surface`, `lint_findings_total`, `ac_count`, `escalated`
- High-risk surface detection checks: `bridge/orchestrator.js`, `bridge/state/*`, `scripts/lock-main.sh`, `scripts/unlock-main.sh`, `dashboard/server.js`.
- Entire emit wrapped in try/catch — never blocks Nog's verdict transition.

### 2. RR computation (`bridge/rr-compute.js`)

- New module at `bridge/rr-compute.js` (peer to `bridge/state/`, not inside it — respects Worf's namespace).
- `computeRR()` reads branch-state.json, register.jsonl, slice files, and regression/ tests.
- Formula: `RR = round(100 * (0.30*slice_pressure + 0.50*surface_volatility + 0.20*ac_coverage_gap))`
- Weights documented as from `project_bashir_design_2026-04-28.md`, subject to tuning.
- Bands: 0-25 green, 26-60 amber, 61+ red.
- Graceful degradation: missing files → rr=0 green.

### 3. RR persistence to branch-state.json

- `recomputeAndPersistRR()` helper in orchestrator writes `regression_risk` block to branch-state.json via `writeJsonAtomic`.
- Schema additive: `{ rr, band, inputs: { slice_pressure, surface_volatility, ac_coverage_gap }, computed_ts }`.
- Triggered at three points:
  - After `SLICE_SQUASHED_TO_DEV` register event (squashSliceToDev)
  - After `NOG_TELEMETRY` emit (ACCEPTED verdict path)
  - After `merge-complete` emit (mergeDevToMain — resets to 0)
- `SLICE_DEFERRED` recompute skipped: gate-mutex.js is Worf-owned (constraint: do not modify bridge/state/* modules). RR recomputes on next squash drain.

### 4. RR pill in topology footer (`dashboard/lcars-dashboard.html`)

- Added `<span id="topo-foot-rr">` before `topo-foot-stats` in the topo-foot div.
- CSS: `.rr-pill` with `.green`, `.amber`, `.red` band classes using existing `--ok-*`, `--warn-*`, `--err-*` tokens.
- Hover tooltip shows three input percentages.
- Empty-dev case: pill shows "RR 0% · clean" in green.
- `renderRRPill(bs)` called from `renderTopoFooter()` — subscribes to existing branch-state polling.

### 5. Tests (all passing)

| Test file | Assertions | Status |
|---|---|---|
| `test/nog-telemetry-emit.test.js` | NOG_TELEMETRY in VALID_EVENTS, payload correct, non-blocking on failure | 3/3 pass |
| `test/rr-compute-empty-dev.test.js` | Empty commits → rr=0 green, missing file → graceful fallback | 2/2 pass |
| `test/rr-compute-mixed.test.js` | 6-slice mixed → amber range, 10 high-risk → ~100 red, 0 commits → 0 | 3/3 pass |
| `test/rr-pill-render.test.js` | Green/amber/red bands, tooltip values, clean label, missing RR | 5/5 pass |

### Regression check

- Worf's gate-recovery suite: 15/15 pass
- squash-slice-to-dev tests: 4/4 pass
- dashboard-render tests: pass
- state-atomic-write tests: 3/3 pass

## Files changed

- `bridge/state/gate-telemetry.js` — added `NOG_TELEMETRY` to VALID_EVENTS
- `bridge/orchestrator.js` — NOG_TELEMETRY emit, recomputeAndPersistRR helper, 3 trigger sites
- `bridge/rr-compute.js` — new module (computeRR)
- `dashboard/lcars-dashboard.html` — RR pill CSS, DOM, renderRRPill JS
- `test/nog-telemetry-emit.test.js` — new
- `test/rr-compute-empty-dev.test.js` — new
- `test/rr-compute-mixed.test.js` — new
- `test/rr-pill-render.test.js` — new
- `bridge/queue/270-DONE.md` — this report

## Acceptance criteria check

1. ✅ NOG_TELEMETRY event with 7 fields emitted after every ACCEPTED verdict
2. ✅ Emission failure does not block verdict transition (try/catch wrapper)
3. ✅ branch-state.json.regression_risk populated with rr, band, inputs, computed_ts
4. ✅ Topology footer renders RR pill with correct band color
5. ✅ Tooltip on hover shows three input percentages
6. ✅ Empty-dev: pill shows "RR 0% · clean" in green
7. ✅ All four tests pass (13 total assertions)
8. ✅ No regression in Worf's gate-recovery suite (15/15)
