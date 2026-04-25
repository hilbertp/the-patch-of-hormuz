---
id: "197"
title: "F-197 — Dispatch gate fix: hasReviewEvent respects verdict + uses COMMISSIONED fallback"
from: rom
to: nog
status: DONE
slice_id: "197"
branch: "slice/197"
completed: "2026-04-23T17:45:00.000Z"
tokens_in: 42000
tokens_out: 4800
elapsed_ms: 3180000
estimated_human_hours: 1.5
compaction_occurred: false
---

## Summary

Fixed the dispatch-skip bug class in `bridge/orchestrator.js`. The DONE poll loop no longer skips slices whose last Nog verdict was REJECTED, and slices that lack a RESTAGED marker now correctly derive their attempt boundary from the latest COMMISSIONED event instead of treating any prior event as current.

## Changes

**`bridge/orchestrator.js`**

- Added `latestAttemptStartTs(id, regFile)` helper (after `latestRestagedTs`). Returns the latest RESTAGED ts for the slice ID; falls back to latest COMMISSIONED ts; returns `null` if neither exists.
- Rewrote `hasReviewEvent(id, regFile)` to:
  - Use `latestAttemptStartTs` as the attempt boundary (replaces `latestRestagedTs`)
  - Return `false` immediately when cutoff is `null` (no attempt boundary)
  - Only return `true` for `MERGED`, `STUCK`, or `NOG_DECISION { verdict: 'ACCEPTED' }` after the cutoff
  - REJECTED and ESCALATE verdicts are explicitly skipped (not terminal)
- Updated dispatch-site comment at line ~3726 to clarify that rejected verdicts are not terminal and the next DONE must re-dispatch
- Added `latestAttemptStartTs` to `module.exports`

**`test/orchestrator-has-review-event.test.js`**

- Added `latestAttemptStartTs` to imports
- Fixed existing test B (was asserting REJECTED → true; updated seed to use ACCEPTED verdict)
- Fixed existing "unrelated slice" test (added COMMISSIONED for slice 888 and changed verdict to ACCEPTED)
- Updated test C comment to specify ACCEPTED
- Added 4 `latestAttemptStartTs` unit tests (null, RESTAGED preferred, COMMISSIONED fallback, empty)
- Added 7 dispatch gate regression tests 197-A through 197-G

## Tests

25 tests pass (was 14 before). Full suite: 18 test files, 0 failures.

Tests 197-A through 197-G:
- A: REJECTED → false ✓
- B: ACCEPTED → true ✓
- C: MERGED → true ✓
- D: STUCK → true ✓
- E: RESTAGED cutoff scopes out pre-RESTAGED REJECTED → false ✓
- F: COMMISSIONED fallback cutoff scopes out pre-COMMISSIONED REJECTED → false ✓
- G: ESCALATE → false ✓

## Notes

- Diff: ~51 LOC added in orchestrator.js, ~131 LOC net in test file (well under the 100 LOC limit for source)
- Slices 189 and 194 self-heal on next poll tick after this merges and the container restarts
- `.auto-memory/project_dispatch_skip_bug.md` did not exist; the dispatch-skip bug class is now closed by this fix
