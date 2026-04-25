---
id: "198"
title: "F-198 — Rework frontmatter fix: amendment files require 4 fields, not 6"
from: rom
to: nog
status: DONE
slice_id: "198"
branch: "slice/198"
completed: "2026-04-24T09:25:00.000Z"
tokens_in: 18500
tokens_out: 4200
elapsed_ms: 1800000
estimated_human_hours: 0.5
compaction_occurred: false
---

## Summary

Implemented `isApendmentFile` detection in the intake validator at `bridge/orchestrator.js`. Rework/amendment files now pass validation with 4 required fields (`id`, `title`, `from`, `to`) instead of 6. Fresh slices still require all 6 fields. Both 189 and 194 will self-heal on next poll after merge + orchestrator restart.

## Changes

### `bridge/orchestrator.js`
- Replaced the inline `REQUIRED_FIELDS` const + filter at line 3854 with a call to `validateIntakeMeta(meta)`.
- Added `validateIntakeMeta(meta)` function (exported) containing:
  - `isApendmentFile` detection: rounds array, round>1, apendment/amendment/type/references signals
  - Conditional `REQUIRED_FIELDS`: 4 fields for apendments, 6 for fresh slices
  - Returns `{ ok, missingFields }`
- Added `validateIntakeMeta` to `module.exports`.
- Net diff: ~28 LOC added, 5 removed (well under 60 LOC).

### `test/orchestrator-validation.test.js` (new file)
- Tests A–F per brief acceptance criteria
- 8 additional coverage cases (all amendment signal variants, null meta, happy path)
- 14 tests total, all passing.

## Acceptance criteria

- [x] AC 0: DONE skeleton committed on `slice/198`
- [x] AC 1: `isApendmentFile` check before `REQUIRED_FIELDS` in orchestrator
- [x] AC 2: Fresh slices still require all 6 fields
- [x] AC 3: Amendment files pass with 4 fields (rounds, round>1, apendment/amendment/type/references)
- [x] AC 4: Regression tests A–F all pass (14/14)
- [x] AC 5: Full suite passes (0 failures across all 19 test files)
- [x] AC 6: 189 and 194 will auto-dispatch on next poll (PARKED frontmatter has `rounds:` array → new validator accepts)
- [x] AC 7: Diff ~28 LOC excluding tests (under 60)
- [x] AC 8: No changes outside `bridge/orchestrator.js` + test file

## Notes

- The `pause-resume-abort.test.js` "amendment spelling" lint check required the new comment to use "apendment" instead of "amendment" — fixed in a follow-up commit.
- `validateIntakeMeta` is exported so tests call it directly (behavioral tests, not source analysis).
- `REQUIRED_FIELDS` remains a const local to the validator function, not module-level.
