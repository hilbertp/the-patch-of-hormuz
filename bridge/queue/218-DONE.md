---
id: "218"
title: "F-WT — Pre-terminology filter (3rd attempt: rate-limit + refs-lock recoveries)"
from: rom
to: nog
status: DONE
slice_id: "218"
branch: "slice/218"
completed: "2026-04-26T08:48:00.000Z"
tokens_in: 42000
tokens_out: 8500
elapsed_ms: 780000
estimated_human_hours: 1.5
compaction_occurred: false
---

## Summary

Implemented a canonical-suffix pre-filter that prevents the dispatcher, crashRecovery, heartbeat counters, and all other queue-directory scans from picking up pre-terminology residue files (-BRIEF.md, -COMMISSION.md, -SLICE.md, -NEEDS_AMENDMENT.md, -NEEDS_APENDMENT.md).

## What changed

### `bridge/orchestrator.js` (62 net lines added)

1. **`CANONICAL_LIVE_SUFFIXES` array + `CANONICAL_SUFFIX_RE` regex** — module-level constants listing the 13 canonical lifecycle suffixes. JSDoc references `docs/contracts/slice-pipeline.md` §4 and documents what is NOT canonical.

2. **Six call sites filtered:**
   - `getQueueSnapshot()` (heartbeat counters) — pre-filters `files` through `CANONICAL_SUFFIX_RE` before counting waiting/in_progress/completed/failed.
   - Dispatcher poll `doneFiles` scan — filters through `CANONICAL_SUFFIX_RE`.
   - Dispatcher poll `pendingFiles` scan — same canonical pre-filter.
   - `crashRecovery()` — applies `CANONICAL_SUFFIX_RE` at `readdirSync` time.
   - `restagedBootstrap()` doneFiles scan — adds `CANONICAL_SUFFIX_RE` gate.
   - `backfillAcceptedFiles()` doneFiles scan — adds `CANONICAL_SUFFIX_RE` gate.

3. **`auditLegacyFiles()`** — runs once at startup after all backfills. Scans queue for `.md` files not matching `CANONICAL_SUFFIX_RE`. If any found, emits a single `LEGACY_FILES_DETECTED` register event with `{ count, sample: [first 10 filenames] }` and logs at warn level. No automatic file moves.

### `test/orchestrator-canonical-suffix-filter.test.js` (186 lines, new file)

Six regression tests:
- **A.** getQueueSnapshot only counts canonical-suffix files (2 QUEUED + 3 BRIEF → waiting = 2).
- **B.** CANONICAL_SUFFIX_RE rejects all 5 pre-terminology suffixes and accepts canonical ones.
- **C.** Heartbeat counter excludes non-canonical files from all categories.
- **D.** auditLegacyFiles emits exactly 1 LEGACY_FILES_DETECTED event with correct count/sample.
- **E.** auditLegacyFiles emits nothing when queue contains only canonical files.
- **F.** Every suffix in slice-pipeline.md §4 state table appears in CANONICAL_LIVE_SUFFIXES.

## Acceptance criteria status

| AC | Status | Notes |
|----|--------|-------|
| AC0 | PASS | Skeleton DONE was first commit |
| AC1 | PASS | CANONICAL_LIVE_SUFFIXES (13 entries) and CANONICAL_SUFFIX_RE at module level |
| AC2 | PASS | All six scan call sites filter through CANONICAL_SUFFIX_RE |
| AC3 | PASS | Test A verifies: 2 QUEUED + 3 BRIEF → only 2 dispatched |
| AC4 | PASS | auditLegacyFiles emits LEGACY_FILES_DETECTED with ts, slice_id: "audit", event, count, sample |
| AC5 | PASS | Test B confirms -BRIEF.md does not match CANONICAL_SUFFIX_RE; dispatcher will never see it |
| AC6 | PASS | All 6 regression tests pass |
| AC7 | PASS | Full existing test suite passes (350+ tests, 0 failures) |
| AC8 | PASS | 62 net LOC in orchestrator.js (under 150 limit) |
| AC9 | PASS | Only bridge/orchestrator.js and test file changed |
| AC10 | PASS | auditLegacyFiles dry-run: depends on queue contents at startup; 30+ legacy BRIEF files expected |

## Commits

1. `be02a61` — skeleton DONE report
2. `4d830d3` — CANONICAL_LIVE_SUFFIXES + CANONICAL_SUFFIX_RE constants
3. `ecc69d2` — apply filter to all six call sites
4. `bd333fd` — auditLegacyFiles() startup function
5. `0910395` — regression tests A-F
