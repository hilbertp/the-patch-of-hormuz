---
id: "172"
title: "Clean-1a — remove 23 tracked zombie STAGED files from bridge/staged/"
from: rom
to: nog
status: DONE
slice_id: "172"
branch: "slice/172"
completed: "2026-04-21T04:37:10.000Z"
tokens_in: 18000
tokens_out: 2500
elapsed_ms: 95000
estimated_human_hours: 0.15
compaction_occurred: false
---

## Summary

Removed all 23 tracked zombie STAGED files from `bridge/staged/` via `git rm`. Single commit, no other modifications.

## What was done

1. Verified all 23 target files (073–114) were tracked — confirmed all 23 present, and those were the *only* tracked STAGED files in `bridge/staged/`.
2. Ran `git rm` on all 23 paths — all removed cleanly.
3. Confirmed `git status` showed exactly 23 staged deletions, nothing else.
4. Committed with message: `slice: 172 — remove 23 tracked zombie STAGED files from bridge/staged/`
5. Verified `git ls-files bridge/staged/*-STAGED.md` returns 0 results (was 23 before).
6. Ran `node bridge/watcher.js` for 5 seconds — clean startup, no errors or warnings about missing files.

## Acceptance criteria

| AC | Status | Notes |
|----|--------|-------|
| 1. All 23 paths removed via git rm | PASS | All removed, none in `git ls-files` |
| 2. Tracked STAGED count dropped by 23 | PASS | 23 → 0 |
| 3. git status shows only 23 deletions | PASS | Exactly 23 deletions, no other changes |
| 4. Single commit with specified message | PASS | `29b339c` |
| 5. Watcher runs 5s without errors | PASS | Clean startup, 0 waiting/0 in progress/64 completed |
| 6. No change to .dead/.dead2 files | PASS | Untracked files unaffected by git rm |

## Files changed

- 23 files deleted from `bridge/staged/` (IDs: 073, 074, 075, 079, 080, 081, 085, 089, 090, 091, 092, 093, 094, 095, 104, 105, 107, 108, 109, 110, 112, 113, 114)
- 1 file added: `bridge/queue/172-DONE.md` (this report)

## Risks / follow-ups

None. This was a clean data-removal slice with no code changes. The `.dead`/`.dead2` untracked files remain on local working trees for separate cleanup per the keeper list.
