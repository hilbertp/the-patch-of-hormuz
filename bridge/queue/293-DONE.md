---
id: "293"
title: "F-Disp-2 — depends-on becomes a real dispatch gate"
from: rom
to: nog
status: DONE
slice_id: "293"
branch: "slice/293"
completed: "2026-05-06T07:36:30.000Z"
tokens_in: 28000
tokens_out: 4500
elapsed_ms: 78000
estimated_human_hours: 1.5
compaction_occurred: false
---

## Summary

Made `--depends-on` a real dispatch gate in the orchestrator. Previously the field was informational only — now slices with unmet dependencies are deferred until all listed IDs have `MERGED` or `SLICE_MERGED_TO_MAIN` events in the register.

## Changes

1. **`bridge/orchestrator.js`** — `hasMergedEvent()` now recognizes both `MERGED` and `SLICE_MERGED_TO_MAIN` events as satisfying a dependency. Added in-memory `_deferredEmitted` Set for throttling `SLICE_DISPATCH_DEFERRED` register events (one per slice per process lifetime). The poll loop emits that event on first deferral. Exported `depsAreMet` and test helpers.

2. **`bridge/new-slice.js`** — Updated `--depends-on` help text from "informational only" to "blocks dispatch until listed IDs have MERGED or SLICE_MERGED_TO_MAIN event in register."

3. **`bridge/test/depends-on-gate.test.js`** — 10 tests covering: empty deps dispatch immediately, unmet deps deferred, single-dep met dispatches, multi-dep partial deferred, multi-dep all met dispatches, SLICE_MERGED_TO_MAIN equivalence, dedup throttle, null/missing deps, whitespace parsing, "null" string handling.

## Test results

- `bridge/test/depends-on-gate.test.js`: 10 pass, 0 fail
- `bridge/test/gate-recovery.test.js`: 15 pass, 0 fail
- `bridge/test/gate-flow-flag.test.js`: 6 pass, 0 fail
- `bridge/test/history-pill-outcomes.test.js`: 6 pass, 0 fail

## Acceptance criteria status

1. Empty/missing `depends_on` → dispatched as before ✓
2. Unmet single dep → deferred; met → dispatched ✓
3. Multi-dep requires ALL merged ✓
4. `SLICE_MERGED_TO_MAIN` satisfies like `MERGED` ✓
5. `SLICE_DISPATCH_DEFERRED` emitted once, deduped in-memory ✓
6. `new-slice.js` help text updated ✓
7. Tests pass (10 new tests) ✓
8. No regressions ✓
