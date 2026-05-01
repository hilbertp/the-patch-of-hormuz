---
id: "273"
title: "F-Bash-10 — Wire squashSliceToDev into acceptAndMerge + remove legacy main-merge"
from: rom
to: nog
status: DONE
slice_id: "273"
branch: "slice/273"
completed: "2026-05-01T09:45:00.000Z"
tokens_in: 185000
tokens_out: 18000
elapsed_ms: 2400000
estimated_human_hours: 4.0
compaction_occurred: false
---

## Summary

Replaced `acceptAndMerge`'s legacy slice→main merge path with gate-aware squash-to-dev routing. Every Nog-ACCEPTED slice now either squashes to `dev` (when no gate is running) or defers to a post-gate drain queue (when the gate is active). Main is only ever modified by `mergeDevToMain` (slice 269).

## Changes

### `bridge/orchestrator.js`

1. **Import**: Added `shouldDeferSquash` from `bridge/state/gate-mutex.js`.

2. **`acceptAndMerge` rewritten** (scope §1):
   - Removed the call to `mergeBranch(id, branchName, title)`.
   - Added gate check via `shouldDeferSquash()`:
     - **true** (gate running): appends `{ slice_id, accepted_ts }` to `branch-state.dev.deferred_slices` via `writeJsonAtomic`, emits `SLICE_DEFERRED` register event, returns `{ success: true, deferred: true }`.
     - **false** (no gate): calls `squashSliceToDev(id, title, branchName)`, returns success/failure matching existing contract.
   - No `unlock-main.sh` / `lock-main.sh` calls remain in this function.

3. **`handleAccepted` updated**: Handles the new `deferred` return from `acceptAndMerge` — prints deferred status, skips MERGED event and archival.

4. **Startup recovery updated**: Handles deferred case for orphaned ACCEPTED files during crash recovery.

5. **`readSliceMeta(sliceId)` added**: Reads title and branch from queue files (ACCEPTED, PARKED, DONE, IN_PROGRESS) with convention fallback for branch naming.

6. **`drainDeferredAfterGate()` added** (scope §2):
   - Reads `branch-state.dev.deferred_slices`, sorts by `accepted_ts` (tiebreak: numeric slice ID).
   - For each entry, reads metadata via `readSliceMeta`, calls `squashSliceToDev`.
   - Halts on first conflict — remaining slices stay deferred for next cycle.
   - After drain, if `gate.status === 'IDLE'` and `dev.commits_ahead_of_main > 0`, transitions to `ACCUMULATING`.

7. **Drain wired at all release sites**: `drainDeferredAfterGate()` called after every `releaseGateMutex` invocation:
   - `_gateTestsUpdated` — regression-fail timeout + test-fail paths
   - `_gateAbort` — abort path
   - `abortGate` — defensive mutex cleanup
   - `mergeDevToMain` — regression-pass, branch-state-unreadable, no-slices-on-dev, push-rejected, merge-failed catch paths

8. **Exports**: Added `drainDeferredAfterGate` and `readSliceMeta` to `module.exports`.

### New test files (6)

| Test | Assertion |
|---|---|
| `accept-and-merge-squash-to-dev.test.js` | IDLE gate → squash lands on dev with trailers, main unchanged |
| `accept-and-merge-deferred-during-gate.test.js` | Gate running → no squash, deferred_slices entry, SLICE_DEFERRED event |
| `post-gate-drain-on-pass.test.js` | Two deferred slices drain in accepted_ts order, gate→ACCUMULATING |
| `post-gate-drain-on-fail.test.js` | Drain on regression-fail, gate stays GATE_FAILED |
| `post-gate-drain-conflict-halts.test.js` | Conflict mid-drain halts, remaining stay deferred |
| `legacy-main-merge-removed.test.js` | Static: no mergeBranch, no --no-ff, no lock scripts in acceptAndMerge |

## Test results

- All 6 new tests: **PASS**
- `squash-slice-to-dev.test.js` (slice 266): **PASS** (4/4)
- `state-gate-mutex.test.js` (slice 259): **PASS** (9/9)
- `orchestrator-accept-rename.test.js`: **PASS** (6/6)
- `gate-abort.test.js` (slice 271): **PASS** (4/4)
- `regression-fail.test.js`: **PASS** (3/3)
- `dev-to-main-merge.test.js` (slice 269): **PASS** (5/5)
- `dev-to-main-merge-fail.test.js`: **PASS** (3/3)
- `dev-to-main-merge-trailer.test.js`: **PASS** (4/4)
- `orchestrator-merge-no-ff.test.js`: **PASS** (5/5)
- `orchestrator-nog-merge.test.js`: **PASS** (13/13)

### Pre-existing failure (not introduced by this slice)

- `regression-pass.test.js`: Fails with "Mutex should NOT be released on pass" — this was already broken before this slice (verified by running the test against the unmodified codebase on `main`). The test was written pre-slice-269 and hasn't been updated for the `mergeDevToMain()` call that slice 269 added to the regression-pass path.

## Quality checks

- `acceptAndMerge` contains zero `git merge --no-ff` calls targeting main ✓
- `acceptAndMerge` contains zero direct `gate-running.json` reads ✓
- `SLICE_DEFERRED` goes through `registerEvent` helper ✓
- `drainDeferredAfterGate` emits no new events itself (delegates to `squashSliceToDev` which emits `SLICE_SQUASHED_TO_DEV`) ✓
- No changes to `bridge/state/*` modules ✓

## TODOs surfaced

- `regression-pass.test.js` needs updating for slice 269's `mergeDevToMain` call on the pass path — the old assertion that mutex stays held is now invalid.
- `mergeBranch` function is now dead code (no callers) — safe to remove in a future cleanup slice.
