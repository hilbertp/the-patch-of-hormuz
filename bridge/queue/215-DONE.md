---
id: "215"
title: "F-WI — Slice ID retention: stop stripping rounds in --restage; add attempt_number for multi-attempt history"
from: rom
to: nog
status: DONE
slice_id: "215"
branch: "slice/215"
completed: "2026-04-25T16:20:00.000Z"
tokens_in: 52000
tokens_out: 12000
elapsed_ms: 960000
estimated_human_hours: 1.5
compaction_occurred: false
---

## Summary

Fixed the `--restage` path in `bridge/new-slice.js` to preserve `rounds:` history and added `attempt_number` to `appendRoundEntry` in `bridge/orchestrator.js` for unambiguous multi-attempt tracking.

## Changes

### bridge/new-slice.js
- **Deleted `stripRoundsFields` function** (was lines 218–232) and its call site (was lines 283–285). The `rounds:` array is now preserved verbatim through `--restage`, honoring the slice-ID-retention rule from `feedback_reuse_slice_id.md`.
- **Added re-stage notice injection**: every `--restage` invocation prepends a `## Re-stage notice — attempt N` section between frontmatter and body. Multiple restages accumulate notices in order.

### bridge/orchestrator.js
- **Extended `appendRoundEntry`** to accept and emit `attempt_number` as the second YAML line after `round:`. Defaults to `1` when omitted (backward compat).
- **Added `computeNextAttemptNumber(sliceFilePath, round)` helper**: reads the slice file's `rounds:` array and returns the next attempt number for the given round. Returns 1 for fresh rounds, N+1 for repeats.
- **Wired `attempt_number` at all 5 call sites**: MAX_ROUNDS_EXHAUSTED, unreadable verdict, ESCALATE, ACCEPTED, and REJECTED paths all now compute and pass `attempt_number`.
- **Exported** `appendRoundEntry` and `computeNextAttemptNumber` for test access.

### test/new-slice-restage-history.test.js (new)
- **Test A**: `--restage` preserves `rounds:` in body frontmatter.
- **Test B**: `appendRoundEntry` defaults `attempt_number` to 1.
- **Test C**: `appendRoundEntry` called twice for same round → second gets `attempt_number: 2`.
- **Test D**: `--restage` with prior attempt in trash → re-stage notice injected.
- **Test E**: Two `--restage` invocations produce two notices in order (attempt 2, attempt 3).
- **Test F**: `--restage` without `--body-file` works (no crash).

### test/new-slice-restage.test.js (updated)
- **AC4** updated from "rounds stripped" to "rounds preserved" to match new behavior.

## Acceptance criteria

- **AC0** Skeleton DONE — first commit.
- **AC1** `stripRoundsFields` deleted from `bridge/new-slice.js`.
- **AC2** `--restage` with `rounds:` in body → preserved in output.
- **AC3** `appendRoundEntry` accepts `attempt_number`, defaults to 1.
- **AC4** All 5 call sites pass computed `attempt_number`.
- **AC5** `computeNextAttemptNumber` returns 1 for fresh, N+1 for repeats.
- **AC6** Re-stage notice injected with attempt number.
- **AC7** Two consecutive restages produce two notices in order.
- **AC8** Tests A–F pass.
- **AC9** Full test suite passes (0 failures, including updated AC4 in old test).
- **AC10** Diff: 96 LOC (34+62 insertions minus 25 deletions) excluding tests — under 250.
- **AC11** Only `bridge/new-slice.js`, `bridge/orchestrator.js`, and test files changed.
- **AC12** This report confirms the strip-rounds bug is closed at the source per `feedback_reuse_slice_id.md`.

## Rule confirmation

The `feedback_reuse_slice_id.md` rule ("a slice keeps its ID across all re-attempts; rounds: array is never stripped") is now honored end-to-end through `--restage`. The `stripRoundsFields` function — the source of the violation — has been deleted entirely.
