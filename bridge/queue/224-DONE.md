---
id: "224"
title: "F-W1 — Push-verify guard: ls-remote read-back after git push origin main"
from: rom
to: nog
status: DONE
slice_id: "224"
branch: "slice/224"
completed: "2026-04-26T11:30:00.000Z"
tokens_in: 38000
tokens_out: 8500
elapsed_ms: 420000
estimated_human_hours: 1.5
compaction_occurred: false
---

## Summary

Added defense-in-depth push verification (W1 guard) to `mergeBranch()` in `bridge/orchestrator.js`. After every `git push origin main`, the system now reads back origin's actual SHA via `git ls-remote` and compares it to the local SHA. On mismatch, it halts the pipeline to prevent the silent-push-failure class that contributed to the 2026-04-24 main-rewind catastrophe.

## Changes

### `bridge/orchestrator.js`

1. **`PIPELINE_PAUSED_FILE` constant** — resolved path to `bridge/.pipeline-paused`.

2. **`verifyOriginAdvanced(id, expectedSha)`** — new helper (lines ~2724-2740) that runs `git ls-remote origin main`, parses the SHA, and returns `{ ok, originSha, reason }`. Handles ls-remote failures gracefully.

3. **`mergeBranch()` integration** — after the push succeeds, calls `verifyOriginAdvanced`. On mismatch:
   - Emits `MERGE_NOT_PUSHED` register event with `{ slice_id, local_sha, origin_sha, reason }`.
   - Writes `bridge/.pipeline-paused` with the same payload as JSON.
   - Returns `{ success: false, sha: null, error: 'merge_not_pushed' }` — MERGED event is NOT emitted.
   - On push failure (exception), the existing warn-and-continue path is preserved with an early return.

4. **`poll()` dispatch guard** — at cycle start, if `bridge/.pipeline-paused` exists, logs the reason and skips dispatch entirely. Placed after the rate-limit gate, before queue directory read.

### `test/orchestrator-push-verify.test.js`

9 regression tests covering:
- A: Happy path — matching SHA → `{ ok: true }`
- B: Mismatch → `{ ok: false }` with correct reason
- B2: ls-remote failure → graceful `{ ok: false }`
- C: MERGE_NOT_PUSHED event has required payload fields (source check)
- C2: `.pipeline-paused` flag written on mismatch (source check)
- D: `mergeBranch` returns failure on mismatch (source check)
- D2: `verifyOriginAdvanced` called between push and final success return
- E: `poll()` checks `.pipeline-paused` before dispatch
- E2: Pipeline-paused check reads and logs the reason

## Tasks

- [x] T1: Skeleton DONE
- [x] T2: Add `verifyOriginAdvanced(id, expectedSha)` helper
- [x] T3: Call from `mergeBranch` after push succeeds
- [x] T4: On mismatch — emit MERGE_NOT_PUSHED, write `.pipeline-paused`, return failure
- [x] T5: Dispatch loop pause check for `.pipeline-paused`
- [x] T6: Regression tests (9 tests, all passing)
- [x] T7: Finalize DONE

## Acceptance Criteria

- [x] AC0: Skeleton DONE first commit
- [x] AC1: `verifyOriginAdvanced(id, expectedSha)` exists in `bridge/orchestrator.js`
- [x] AC2: Called from `mergeBranch` after successful push, before MERGED event emission
- [x] AC3: On mismatch, emits `MERGE_NOT_PUSHED { ts, slice_id, event, local_sha, origin_sha, reason }`
- [x] AC4: On mismatch, writes `bridge/.pipeline-paused` with payload as JSON
- [x] AC5: On mismatch, returns `{ success: false, sha: null, error: 'merge_not_pushed' }`, no MERGED
- [x] AC6: Dispatch loop skips if `.pipeline-paused` exists, logging the reason
- [x] AC7: Regression tests cover happy, mismatch, and pause-flag paths (9 tests)
- [x] AC8: Diff is 53 LOC in orchestrator.js (well under 150)
- [x] AC9: No changes outside `bridge/orchestrator.js` and the test file

## Diff stats

- `bridge/orchestrator.js`: ~53 lines changed (added W1 guard + dispatch check)
- `test/orchestrator-push-verify.test.js`: new file, 9 tests
