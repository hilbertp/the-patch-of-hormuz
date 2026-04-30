---
id: "269"
title: "F-Bash-7 — Auto-merge dev → main no-ff + dev fast-forward"
from: rom
to: nog
status: DONE
slice_id: "269"
branch: "slice/269"
completed: "2026-04-30T20:15:00.000Z"
tokens_in: 85000
tokens_out: 12000
elapsed_ms: 720000
estimated_human_hours: 3.0
compaction_occurred: false
---

## Summary

Implemented `mergeDevToMain()` in `bridge/orchestrator.js` — the single path that merges `dev → main` on regression-pass. The function:

1. Reads `branch-state.json` for batch slice IDs
2. Acquires main-lock via `unlock-main.sh`
3. Runs `git merge --no-ff dev` with commit subject `merge: dev gate batch — slices <range>` and `Slices: <id1>,<id2>,...` trailer
4. Pushes main to origin
5. Fast-forwards dev to main (`git merge --ff-only main`) and pushes dev
6. Updates branch-state: main/dev tip SHAs, clears `dev.commits[]`, resets `commits_ahead_of_main` to 0, populates `last_merge`, sets `gate.status = IDLE`
7. Emits `merge-complete` telemetry with `merge_sha`, `slices`, `dev_fast_forwarded_to`
8. Releases gate mutex (triggers `drainDeferredSlices` via gate-mutex.js)
9. Re-locks main via `lock-main.sh` in a finally block

On any failure (push reject, merge conflict, etc.): emits `gate-abort`, releases mutex, leaves main unchanged.

Wired into `_gateTestsUpdated` — on regression-pass (exit code 0), `mergeDevToMain()` is called while the mutex is still held.

## Files changed

- `bridge/orchestrator.js` — Added `mergeDevToMain()` function (~120 lines); wired into `_gateTestsUpdated` regression-pass path; exported in module.exports
- `test/dev-to-main-merge.test.js` — 5 tests: success + branch-state update, event ordering, --no-ff verification, first-parent check, mutex release
- `test/dev-to-main-merge-trailer.test.js` — 4 tests: Slices trailer with 2/1/3 slices, subject format, comma parseability
- `test/dev-to-main-merge-fail.test.js` — 3 tests: no-slices abort, push-reject abort + rollback, lock relock on failure
- `test/dev-fast-forward.test.js` — 5 tests: local dev==main, remote origin/dev==origin/main, branch-state consistency, dev not deleted, multi-slice

## Test results

All 17 new tests pass. All existing gate tests (gate-abort, state-gate-mutex) continue passing.

## Acceptance criteria

1. ✅ On regression-pass: lock unlocks → dev merges to main via --no-ff → dev fast-forwards to main → lock re-engages
2. ✅ Merge commit subject: `merge: dev gate batch — slices <range>`; body has `Slices: <comma-separated list>` trailer
3. ✅ After success: branch-state main updated, dev.commits[] empty, commits_ahead_of_main === 0, last_merge populated, gate.status === IDLE
4. ✅ merge-complete event emitted with merge_sha, slices, dev_fast_forwarded_to
5. ✅ Mutex released after merge-complete; drainDeferredSlices() runs (gate-mutex.js handles this on releaseGateMutex)
6. ✅ On failure: gate-abort event, mutex released, main state unchanged
7. ✅ Existing gate tests continue passing
8. ✅ Four new test files, 17 tests total, all passing
