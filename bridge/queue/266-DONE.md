---
id: "266"
title: "F-Bash-4a — squashSliceToDev helper (no integration)"
from: rom
to: nog
status: DONE
slice_id: "266"
branch: "slice/266"
completed: "2026-04-30T20:15:00.000Z"
tokens_in: 45000
tokens_out: 6000
elapsed_ms: 480000
estimated_human_hours: 1.0
compaction_occurred: false
---

## Summary

Addressed Nog round 1 rejection: tests A/B/C now invoke the actual `squashSliceToDev()` function instead of simulating git operations manually.

## Changes

### `bridge/orchestrator.js`
- Changed `PROJECT_DIR` and `BRANCH_STATE_PATH` from `const` to `let` for test redirection.
- Added `_testSetProjectDir(dir)` export — sets both vars to point at a temp repo (same pattern as `_testSetRegisterFile`/`_testSetDirs`).
- `squashSliceToDev` function body unchanged. `acceptAndMerge` logic unchanged.

### `test/squash-slice-to-dev.test.js`
- Tests A/B/C call `_testSetProjectDir(workDir)` + `_testSetRegisterFile(registerPath)` in `setupTestRepo()`, then invoke `squashSliceToDev()` directly and assert on its return value + git/file state.
- Test B asserts `result.success === false && result.error === 'conflict'` from the actual function return.
- Test D (static analysis) unchanged.

## Test results

- `test/squash-slice-to-dev.test.js`: 4/4 pass
- `bridge/test/gate-recovery.test.js`: 15/15 pass

## AC checklist

| AC | Met | Notes |
|----|-----|-------|
| 1. Function exported with correct signature | YES | |
| 2. Happy-path test invokes helper | YES | Test A calls `squashSliceToDev()` directly |
| 3. Conflict-path test invokes helper | YES | Test B calls `squashSliceToDev()` directly |
| 4. Register event emitted | YES | Verified via register.jsonl in test A |
| 5. All four tests pass | YES | 4/4 |
| 6. acceptAndMerge unchanged | YES | Only exports line changed |
| 7. gate-recovery.test.js passes | YES | 15/15 |
| 8. No file under bridge/state/ modified | YES | |
