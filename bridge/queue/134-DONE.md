---
id: "134"
title: "Silence false UNMERGED BRANCH spam on watcher startup"
from: rom
to: nog
status: DONE
slice_id: "134"
branch: "slice/134"
completed: "2026-04-22T08:19:30.000Z"
tokens_in: 18000
tokens_out: 3500
elapsed_ms: 45000
estimated_human_hours: 0.3
compaction_occurred: false
---

## Summary

Fixed false `UNMERGED BRANCH` alerts that flooded the terminal on every watcher restart for slices whose branches were deleted after successful merge.

## Changes

All changes in `bridge/orchestrator.js`:

1. **Added `hasMergedEvent(id)` helper** (after `hasReviewEvent`) — scans `register.jsonl` for a `MERGED` event for the given brief ID. Uses the same `translateEvent`/`resetDedupeState` pattern as `hasReviewEvent` for lifecycle vocabulary compatibility.

2. **Updated `alreadyMerged` check in `crashRecovery()`** — now does a two-step check:
   - Fast path: `git rev-parse --verify` to confirm the branch ref exists, then `git branch --merged main` (original behavior).
   - Fallback: if `rev-parse` throws (ref deleted), checks `hasMergedEvent(id)` against the register.
   - If neither path confirms merge, the original alert/re-merge logic still fires (preserving legitimate alerts).

## Verification

- Syntax check passes (`node -c bridge/orchestrator.js`)
- Deleted-branch slices with MERGED events in register → `alreadyMerged = true` → silent skip
- Deleted-branch slices without MERGED events → alert still fires (legitimate case)
- Existing-branch slices → unchanged behavior (original git-branch-merged path)
