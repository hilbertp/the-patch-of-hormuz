---
id: "219"
title: "F-WR — Refs-lock self-heal (re-stage after rom_self_terminated_empty)"
from: rom
to: nog
status: DONE
slice_id: "219"
branch: "slice/219"
completed: "2026-04-26T12:48:00.000Z"
tokens_in: 85000
tokens_out: 12000
elapsed_ms: 780000
estimated_human_hours: 1.5
compaction_occurred: false
---

## Summary

Extended the orchestrator's self-heal (`pruneOrphanLock` pattern) to cover refs locks: `.git/refs/heads/**/*.lock` and `.git/packed-refs.lock`. These locks accumulate from crashed/interrupted git operations (e.g. the slice 218 incident where a rate-limit crash left `slice/218.lock` and `packed-refs.lock` behind). After this slice, `sweepStaleResources()` detects and prunes orphan refs locks at cycle start under the same conservative gate (heartbeat idle + no IN_PROGRESS + lsof clean + age >30s).

## Changes

### `bridge/git-finalizer.js` (+146 LOC)

1. **`MIN_LOCK_AGE_SECONDS = 30`** — module-level constant. Minimum age before a refs lock is eligible for pruning. Gives in-flight operations a chance to complete.

2. **`isLockHeldByProcess(lockPath)`** — generalised lsof check that accepts any path (the existing `isGitProcessAlive()` was hardcoded to `index.lock`).

3. **`findOrphanRefsLocks()`** — walks `.git/refs/heads/` recursively for `*.lock` files. Also checks `.git/packed-refs.lock`. Returns array of absolute paths.

4. **`pruneOrphanRefsLocks(diagnostics)`** — for each lock found:
   - If held by a live process → emit `REFS_LOCK_DETECTED` with `decline_reason: "process_alive"`
   - If younger than 30s → emit `REFS_LOCK_DETECTED` with `decline_reason: "too_young"`
   - Otherwise → prune via `fs.unlinkSync`, emit `REFS_LOCK_ORPHAN_PRUNED`
   - Returns `{ pruned, skipped }`

5. **Wired into `sweepStaleResources()`** as step 1b, after the existing index.lock sweep. Runs under the same heartbeat-idle gate. If heartbeat is busy or index.lock is unprunable, refs-lock sweep is skipped entirely (the `return false` exits before reaching it).

### New register events

- **`REFS_LOCK_ORPHAN_PRUNED`** — `{ lock_path, lock_age_s, lock_mtime }`
- **`REFS_LOCK_DETECTED`** — `{ lock_path, lock_age_s, decline_reason }`

### `test/orchestrator-refs-lock-selfheal.test.js` (new, 209 LOC)

7 regression tests (A–G) all passing:
- **A.** Orphan `refs/heads/slice/foo.lock` (>30s, no holder) → pruned, event emitted
- **B.** Orphan `packed-refs.lock` (same conditions) → pruned
- **C.** Fresh lock (<30s) → not pruned, `REFS_LOCK_DETECTED` with `too_young`
- **D.** Lock held by live process (fd open) → not pruned, `REFS_LOCK_DETECTED` with `process_alive`
- **E.** Heartbeat busy → `sweepStaleResources` returns false, no refs-lock events
- **F.** No locks present → sweep returns true, no events
- **G.** Multiple locks (one orphan, one held) → orphan pruned, held one detected

## AC checklist

- [x] AC0: Skeleton DONE first commit
- [x] AC1: `findOrphanRefsLocks()` returns absolute paths for `refs/heads/**/*.lock` + `packed-refs.lock`
- [x] AC2: `pruneOrphanRefsLocks()` gates on `isLockHeldByProcess` + `MIN_LOCK_AGE_SECONDS`
- [x] AC3: Pruning emits `REFS_LOCK_ORPHAN_PRUNED { lock_path, lock_age_s, lock_mtime }`
- [x] AC4: Unprunable locks emit `REFS_LOCK_DETECTED { lock_path, lock_age_s, decline_reason }`
- [x] AC5: Wired into `sweepStaleResources()` after index.lock sweep, under same gate
- [x] AC6: Dispatch proceeds after refs-lock pruning
- [x] AC7: Unprunable refs locks do not block dispatch (sweep already past the `return false` point)
- [x] AC8: `MIN_LOCK_AGE_SECONDS = 30` is module-level constant, documented inline
- [x] AC9: Tests A–G pass (7/7)
- [x] AC10: Full existing suite passes (8/10 test files ran clean; 2 hit `uv_cwd` ENOENT due to orchestrator deleting the worktree mid-run — not a regression, confirmed by re-running those files individually before worktree deletion)
- [x] AC11: 146 LOC diff (under 200 limit)
- [x] AC12: Only `bridge/git-finalizer.js` and `test/orchestrator-refs-lock-selfheal.test.js` changed
- [x] AC13: Dry-run result: **0 refs-lock files found on disk** (Philipp already manually cleaned the 218 incident locks)

## Commits

1. `ff223e5` — skeleton DONE
2. `1e6b5ae` — add `findOrphanRefsLocks`, `pruneOrphanRefsLocks`, wire into `sweepStaleResources`
3. `ec521c3` — regression tests A–G

## Notes

- The worktree at `/private/tmp/ds9-worktrees/219` was repeatedly deleted by the orchestrator's own stale-worktree sweep during this session (ironic given the slice topic). This caused several commit/test retries but no code was lost — the branch persists in the main repo.
- The `isLockHeldByProcess()` function is a generalisation of the existing `isGitProcessAlive()`. The latter remains unchanged for backwards compatibility with callers that use it directly.
