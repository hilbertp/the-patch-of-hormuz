---
id: "190"
title: "F-190 — RESTAGED marker + scope register reads to current attempt (rescue 186)"
from: rom
to: nog
status: DONE
slice_id: "190"
branch: "slice/190"
completed: "2026-04-22T18:45:00.000Z"
tokens_in: 98000
tokens_out: 18000
elapsed_ms: 3720000
estimated_human_hours: 4.5
compaction_occurred: false
---

## Summary

Introduced the `RESTAGED` lifecycle marker and scoped all register.jsonl reader paths to "events since the latest RESTAGED for this ID." One-shot bootstrap rescues the currently-wedged slice 186 DONE on next orchestrator restart. Full test coverage added for all four changes.

## What was done

### Task 1 — `latestRestagedTs` helper + orchestrator read sites fixed

`bridge/orchestrator.js` changes:
- Added `RESTAGED_BOOTSTRAP_MARKER` constant (`bridge/.restaged-bootstrap-done`)
- Added `latestRestagedTs(id, regFile)` — returns latest RESTAGED ts for an id, or null if none. Accepts optional `regFile` for test isolation.
- `hasReviewEvent(id, regFile)` — now filters NOG_DECISION/MERGED/STUCK to `ts > latestRestagedTs`. Stale pre-RESTAGED reviews are invisible.
- `hasMergedEvent(id, regFile)` — same scoping for MERGED.
- `hasNogReviewEvent(id, regFile)` — same scoping for NOG_DECISION/NOG_ESCALATION. Without this fix a re-staged slice would bypass Nog and go straight to the evaluator.
- All three exported for testing: added to `module.exports`.

### Task 2 — One-shot bootstrap rescue

`restagedBootstrap(opts)` added to orchestrator.js, called on startup (after `crashRecovery()`). Guarded by `bridge/.restaged-bootstrap-done` marker file. Scans `bridge/queue/` for `*-DONE.md` files that have a stale review event but no RESTAGED marker, and appends a synthetic RESTAGED so the scoped `hasReviewEvent` returns false and the DONE advances to Nog. Runs exactly once per install.

`bridge/.restaged-bootstrap-done` added to `.gitignore`.

### Task 3 — `new-slice.js` RESTAGED emission

After writing the STAGED file, reads `bridge/register.jsonl` for any prior COMMISSIONED event matching the assigned id. If found, appends `{"ts":"...","event":"RESTAGED","slice_id":"<id>"}`. No RESTAGED on first-ever staging.

Added env var overrides `DS9_QUEUE_DIR`, `DS9_STAGED_DIR`, `DS9_REGISTER_FILE` for test isolation (no pollution of real bridge dirs).

### Task 4 — `lifecycle-translate.js`

**No edit required.** The `translateEvent` function has an `else { result = rawEvent; }` fallthrough that passes all unknown event names through unchanged, then applies the id/slice_id normalization. RESTAGED passes through correctly with full normalization.

### Task 5 — Dashboard `getRound()` scoped

`dashboard/lcars-dashboard.html::getRound(sliceId)` now:
1. Finds the latest RESTAGED event for the sliceId in `cachedRegisterEvents`.
2. Filters COMMISSIONED events to those with `ts > cutoff` (or all if no RESTAGED).
3. Returns count of filtered events || 1, or the explicit `round` field from the latest if present.

## Additional register read sites found

Beyond the two sites named in the brief:

| Site | Fix applied? |
|---|---|
| `orchestrator.js::hasNogReviewEvent` (NOG_DECISION, NOG_ESCALATION) | YES — scoped. Functional bug: without this, a re-staged slice with stale NOG_DECISION would bypass Nog entirely. |
| `orchestrator.js::countReviewedCycles` (NOG_DECISION, but filters by `root_commission_id`) | NO — not scoped. This function counts across an amendment family (all slices sharing a root), not per-attempt. Scoping by RESTAGED would be wrong here since RESTAGED is per-ID, not per-root. Reported only. |
| `dashboard/server.js::reviewedMap` (NOG_DECISION) | NO — not scoped. This builds a display map of most-recent verdict for the history panel. Last NOG_DECISION wins in the map; after a re-stage + new review, the new verdict naturally overwrites the old one. No functional bug; scoping would break history display for slices that haven't been re-reviewed yet. Reported only. |

## Tests

All four required test files added:

- `test/orchestrator-has-review-event.test.js` — 14 tests covering `latestRestagedTs`, `hasReviewEvent` cases A–D, `hasMergedEvent` cases E–F, and cross-slice isolation.
- `test/ops-round-badge.test.js` — 8 tests covering `getRound` cases A–D and edge cases, plus static analysis of dashboard source for RESTAGED/cutoff logic.
- `test/new-slice-restaged.test.js` — 4 tests covering cases A–D and env var isolation from real register.
- `test/bootstrap-rescue.test.js` — 6 tests covering case 1 (rescue), case 2 (idempotent), case 3 (already has RESTAGED), case 4 (no review → no rescue), case 5 (no DONEs), case 6 (multiple wedged).

Full suite: all existing tests pass.

## Diff (source, excluding tests)

- `bridge/orchestrator.js`: +132 / -15 lines (helper + 3 reader fixes + bootstrap + exports)
- `bridge/new-slice.js`: +23 / -2 lines (RESTAGED emission + env vars)
- `dashboard/lcars-dashboard.html`: +10 / -2 lines (getRound scoping)
- `.gitignore`: +3 lines
- Total source LOC: ~168 additions (within ~220 limit)

## Slice 186 rescue

On the first orchestrator restart after this slice lands, `restagedBootstrap()` will run once, find `186-DONE.md` in the queue, detect the stale NOG_DECISION from 13:19:12Z, append a RESTAGED marker, and write the bootstrap marker file. The next poll cycle will find `186-DONE.md`, call `hasReviewEvent("186")` → false (post-RESTAGED scope), and invoke Nog normally.
