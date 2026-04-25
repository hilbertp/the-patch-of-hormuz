---
id: "208"
title: "F-208 — Main recovery from 2026-04-24 main-rewind: FF to a1aac7f + merge slice/200,201,202 + push"
from: rom
to: nog
status: DONE
slice_id: "208"
branch: "slice/208"
completed: "2026-04-24T19:45:00.000Z"
tokens_in: 18500
tokens_out: 4200
elapsed_ms: 420000
estimated_human_hours: 0.5
compaction_occurred: false
---

# F-208 — Main Recovery: DONE

## Summary

`main` has been fully recovered from the 2026-04-24 rewind. Fast-forwarded to `a1aac7f`, merged slice/200, 201, 202 in order, pushed to origin, and relocked.

## Recovery actions performed

### Step 1 — Sanity probe: PASSED
- `a1aac7f` reachable ✓
- `slice/200`, `slice/201`, `slice/202` all present ✓
- `main` was at `42425fb80801dfcfcc49592b868a2d5207fc80c1` (expected) ✓
- `local == origin == 42425fb` at start ✓

### Step 2 — Recovery sequence

1. `bash scripts/unlock-main.sh` — unlocked successfully
2. `git update-ref refs/heads/main a1aac7f` + `git reset --hard a1aac7f` — fast-forward to today's real chain tip
3. `git merge --no-ff slice/200` → **merge commit `2cdeb7f`** (clean, no conflicts)
4. `git merge --no-ff slice/201` → conflict in `dashboard/lcars-dashboard.html` (both branches added independent sections after the same anchor line); resolved by keeping both sections (Investigation Panel from HEAD + Cost Center from slice/201); committed with `DS9_WATCHER_MERGE=1` → **merge commit `90d7fb9`**
5. `git merge --no-ff slice/202` → **merge commit `8a27efa`** (auto-merged cleanly, `ort` strategy)
6. `git push origin main` → pushed `42425fb..8a27efa` to origin ✓
7. `bash scripts/lock-main.sh` — relocked (`dashboard/lcars-dashboard.html` is `r--r--r--`) ✓

### Step 3 — Verification

```
git log --oneline -6 main:
8a27efa merge: slice/202 — F-202 recovery from 2026-04-24 main-rewind
90d7fb9 merge: slice/201 — F-201 recovery from 2026-04-24 main-rewind
2cdeb7f merge: slice/200 — F-200 recovery from 2026-04-24 main-rewind
a1aac7f slice 199 — round 2: fix stale PID handling, usage comment, add runtime evidence
520735b merge: slice/189
172ced5 slice 198 DONE
```

Ancestry checks:
- `a1aac7f` is ancestor of main ✓
- `f41f5ce` (slice/200 tip) is ancestor of main ✓
- `5bf6796` (slice/201 tip) is ancestor of main ✓
- `227b1fc` (slice/202 tip) is ancestor of main ✓

**Final main SHA:** `8a27efa238a54bea4ea0916b8ed251bd0703d1fe`

**local == origin:** `8a27efa238a54bea4ea0916b8ed251bd0703d1fe` == `8a27efa238a54bea4ea0916b8ed251bd0703d1fe` ✓

## Merge commit SHAs

| Branch    | Merge commit |
|-----------|-------------|
| slice/200 | `2cdeb7f`   |
| slice/201 | `90d7fb9`   |
| slice/202 | `8a27efa`   |

## AC status

| AC | Status | Note |
|----|--------|------|
| 0  | ✓ DONE | DONE skeleton committed first |
| 1  | ✓ DONE | `a1aac7f` is ancestor of main |
| 2  | ✓ DONE | `f41f5ce` (slice/200 tip) is ancestor |
| 3  | ✓ DONE | `5bf6796` (slice/201 tip) is ancestor |
| 4  | ✓ DONE | `227b1fc` (slice/202 tip) is ancestor |
| 5  | ✓ DONE | local==origin after push |
| 6  | ⚠ NOTE | `bridge/orchestrator.js` is NOT byte-identical to slice/202 tip — but no accidental edits occurred. The diff shows `latestAttemptStartTs` and related `hasReviewEvent` changes from slices 192–199 (the recovered chain). These are legitimate additions the three-way merge correctly preserved. slice/202 tip was based on `42425fb` (pre-recovery) and didn't know about the recovered-chain changes; the merge properly incorporated both. |
| 7  | ✓ DONE | Final main SHA, merge commit SHAs, local==origin all in this report |
| 8  | ✓ DONE | No new files outside `bridge/queue/208-*.md` |
| 9  | ✓ DONE | `dashboard/lcars-dashboard.html` is `r--r--r--` after relock |

## Incident reference

This recovery addresses incident `project_main_rewind_2026-04-24` — `ensureMainIsFresh()` ran `git reset --hard origin/main` on a locally-ahead main, silently wiping 7 merges.

## ⚠ Slice 209 still required

This slice restores the tree only. The underlying bug in `ensureMainIsFresh()` (reset-on-ahead behavior) is NOT fixed here. Slice 209 contains the actual fix and must land on this recovered main to prevent recurrence.
