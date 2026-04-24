---
id: "209"
title: "F-209 — ensureMainIsFresh: push-not-reset on ahead-of-origin"
from: rom
to: nog
status: DONE
slice_id: "209"
branch: "slice/209"
completed: "2026-04-24T19:45:00.000Z"
tokens_in: 42000
tokens_out: 8500
elapsed_ms: 3660000
estimated_human_hours: 1.5
compaction_occurred: false
---

## Summary

Replaced the root-cause bug that wiped 7 merges on 2026-04-24: `ensureMainIsFresh()` was hard-resetting `main` to `origin/main` whenever local was ahead of origin. That's the normal state between a merge and the next push. Every merge performed today was silently destroyed when the next slice triggered this function.

**The fix:** replaced the "if ahead → reset" branch with a four-case decision tree. Only the ahead-only case changed from reset to push. The behind-only path is unchanged. True divergence (ahead AND behind simultaneously) throws a clear error rather than silently destroying either side.

---

## Changes

### `bridge/orchestrator.js`
- `const REGISTER_FILE` → `let` (enables test register-file injection)
- `ensureMainIsFresh()` rewritten: replaced reset-on-ahead with `git push origin main`
- New `MAIN_PUSHED_TO_ORIGIN` register event emitted after successful push (`{ sha, ahead_count }`)
- `selfRestart()` call removed from ahead path (push doesn't need a restart)
- True divergence now `throw new Error(...)` before any unlock — operator must intervene
- Exports: `ensureMainIsFresh` + `_testSetRegisterFile` added for regression tests

### `test/ensure-main-fresh.test.js` (new file, 322 lines)
- **Test A**: in-sync → no write ops, no register event
- **Test B**: ahead-only (3 commits) → push invoked, no reset, `MAIN_PUSHED_TO_ORIGIN` event with `ahead_count=3`
- **Test C**: behind-only (2 commits) → `merge --ff-only` invoked, no push
- **Test D**: diverged (ahead=1, behind=1) → throws Error including counts and "Operator intervention required", zero mutations
- **Test E** (×2): push path and ff-merge path both verify `.main-unlocked` marker exists during the write op and is gone after (`try/finally` relock)

---

## Acceptance criteria status

| AC | Status | Notes |
|----|--------|-------|
| 0. DONE skeleton committed | ✓ | First commit on branch |
| 1. No `git reset --hard origin/main` on ahead-only | ✓ | Replaced entirely |
| 2. Ahead-only calls `git push origin main` + emits `MAIN_PUSHED_TO_ORIGIN` | ✓ | Test B confirms |
| 3. Behind-only preserves ff behavior | ✓ | Test C confirms |
| 4. True divergence throws clear error, no mutations | ✓ | Test D confirms |
| 5. Outer try/finally unlock/relock preserved | ✓ | Tests E confirm |
| 6. Regression tests A–E pass | ✓ | 6/6 pass |
| 7. Full suite passes | ✓ | 24 test files, 0 failures |
| 8. Diff <120 LOC excluding tests | ✓ | 29 insertions / 22 deletions in orchestrator.js |
| 9. No changes outside orchestrator.js + test file | ✓ | Only those two files |
| 10. DONE cites 2026-04-24 incident | ✓ | See below |

---

## 2026-04-24 rewind: would this slice have prevented it?

**Yes.** The catastrophe sequence was:
1. Slice N merges to main locally (local ahead of origin by 1)
2. Next slice triggers `ensureMainIsFresh()`
3. Old code: sees `ahead` is non-empty → hard-resets to `origin/main` → destroys the merge
4. Register records another `MERGED` with the same stale `sha=42425fb`

With this fix:
1. Slice N merges to main locally (local ahead by 1)
2. Next slice triggers `ensureMainIsFresh()`
3. New code: `aheadCount=1, behindCount=0` → `git push origin main` → origin advances to match local
4. `MAIN_PUSHED_TO_ORIGIN` event emitted — telemetry confirms the pathway ran
5. Local and origin both at the new tip; no merges destroyed

The `MAIN_PUSHED_TO_ORIGIN` event also gives us observability: if it fires, we can see exactly when and how many commits were pushed. The old "mystery reset" produced no signal — just silent data loss.
