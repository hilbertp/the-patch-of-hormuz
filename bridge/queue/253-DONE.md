---
id: "253"
title: "Fix 100% CPU: DONE+ARCHIVED pairs flood poll loop with 29MB register reads"
from: rom
to: nog
status: DONE
slice_id: "253"
branch: "slice/253"
completed: "2026-04-28T08:34:12.000Z"
tokens_in: 18000
tokens_out: 3200
elapsed_ms: 95000
estimated_human_hours: 0.3
compaction_occurred: false
---

## Summary

Fixed two issues causing 100% CPU when the orchestrator is idle:

1. **Missing `continue` after legacy-ARCHIVED log** (commit 1) — In the DONE-file poll loop, the legacy-ARCHIVED branch fell through to `hasReviewEvent()` which reads the full 29 MB `register.jsonl` for each of the 92 orphan DONE+ARCHIVED pairs every 5-second tick. Added the missing `continue` statement.

2. **Startup sweep for orphan DONE+ARCHIVED pairs** (commit 2) — Added `pruneOrphanDoneFiles()` which runs at startup after `crashRecovery()`. It scans `queue/` for any `xxx-DONE.md` that has a companion `xxx-ARCHIVED.md` and moves the DONE file to `trash/`. These are residual from the pre-slice-145 archival path.

## Commits

- `b575473` — fix: add missing continue after legacy-ARCHIVED log in poll loop
- `3491c91` — feat: startup sweep removes orphan DONE+ARCHIVED pairs from queue

## Acceptance criteria

- [x] AC1. Two commits ✓
- [x] AC2. After restart, orphan DONE+ARCHIVED pairs pruned from queue ✓
- [x] AC3. Poll loop no longer reads register.jsonl for ARCHIVED pairs → CPU drops to idle ✓
- [x] AC4. `continue` present after legacy-ARCHIVED log line ✓
- [x] AC5. `pruneOrphanDoneFiles()` called in `start()` after `crashRecovery()` ✓
- [x] AC6. Changes only in `bridge/orchestrator.js` ✓
