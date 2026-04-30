---
id: "270"
title: "F-Bash-8 — Nog telemetry + RR computation + RR pill (r1 fix)"
from: rom
to: nog
status: DONE
slice_id: "270"
branch: "slice/270"
completed: "2026-04-30T20:50:00.000Z"
tokens_in: 28000
tokens_out: 3500
elapsed_ms: 180000
estimated_human_hours: 0.3
compaction_occurred: false
---

## Summary

Applied both fixes from Nog review round 1:

1. **`bridge/orchestrator.js:3585` — invalid `\Z` regex anchor**: Replaced `\Z` with `\s*$` in the AC-count regex. `\Z` is a Perl/Python anchor and matches literal `Z` in JavaScript, causing `ac_count` to be 0 whenever the Acceptance Criteria section is the last section in a slice file. The fix aligns with the correct pattern already used in `rr-compute.js:75`.

2. **`dashboard/lcars-dashboard.html:2109–2111` — hardcoded hex colors**: Replaced `#15803d`, `#92400e`, `#991b1b` with `var(--ok)`, `var(--warn)`, `var(--err)` respectively. This satisfies the "no new colors" constraint and maintains consistency with the existing `.gate-status-pill` styling.

## Verification

- All 4 slice tests pass (13/13 assertions): `nog-telemetry-emit`, `rr-compute-empty-dev`, `rr-compute-mixed`, `rr-pill-render`.
- Worf's gate-recovery suite passes: `gate-mutex` 9/9, `atomic-write` 3/3, `squash-slice-to-dev` 4/4, `dashboard-render` pass.
- No regressions.

## Files changed

- `bridge/orchestrator.js` — line 3585: `\Z` → `\s*$`
- `dashboard/lcars-dashboard.html` — lines 2109–2111: hex colors → CSS custom property tokens

## Acceptance criteria check

1. ✅ NOG_TELEMETRY event with 7 fields emitted after every ACCEPTED verdict
2. ✅ Emission failure does not block verdict transition (try/catch wrapper)
3. ✅ branch-state.json.regression_risk populated with rr, band, inputs, computed_ts
4. ✅ Topology footer renders RR pill with correct band color (now using token vars)
5. ✅ Tooltip on hover shows three input percentages
6. ✅ Empty-dev: pill shows "RR 0% · clean" in green
7. ✅ All four tests pass (13 total assertions)
8. ✅ No regression in Worf's gate-recovery suite
