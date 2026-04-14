---
id: "086"
title: "Fix orphan IN_PROGRESS: untrack queue files from git + crash recovery ACCEPTED/BRIEF check"
from: obrien
to: kira
status: DONE
brief_id: "086"
branch: "slice/086-fix-orphan-in-progress"
completed: "2026-04-14T19:15:00.000Z"
tokens_in: 28000
tokens_out: 3500
elapsed_ms: 120000
estimated_human_hours: 0.5
compaction_occurred: false
---

## Summary

Fixed the orphan IN_PROGRESS re-queue loop caused by two root issues:

1. **Git tracking removed** — Ran `git rm -r --cached bridge/queue/` to untrack all 139 queue `.md` files from git. Files remain on disk for the watcher. Added `.gitignore` patterns (`bridge/queue/*.md`, `bridge/queue/*.json`) to prevent future tracking. Created `bridge/queue/.gitkeep` (excluded from ignore) to preserve the directory in fresh checkouts.

2. **Crash recovery hardened** — Added `hasAccepted` and `hasBrief` checks alongside `hasDone` and `hasError` in `crashRecovery()`. Updated `resolvedAs` to reflect all four terminal states. Updated `actions.push` to distinguish `cleared_accepted` and `cleared_brief` types.

## Verification

- `git ls-files bridge/queue/` returns only `bridge/queue/.gitkeep`
- `059-IN_PROGRESS.md` and `063-IN_PROGRESS.md` no longer in git index
- `.gitignore` blocks future queue file tracking
- Crash recovery now recognizes ACCEPTED and BRIEF as terminal states

## Files changed

- `.gitignore` — added queue exclusion patterns
- `bridge/watcher.js` — crash recovery function (lines ~1608-1722)
- `bridge/queue/.gitkeep` — new empty file for directory preservation
- 139 queue files removed from git tracking (still on disk)
