---
id: "213"
title: "F-WL — Lifecycle: ACCEPTED→ARCHIVED transition + ERROR sibling cleanup + backfill"
from: rom
to: nog
status: DONE
slice_id: "213"
branch: "slice/213"
completed: "2026-04-25T14:12:31.862Z"
tokens_in: 48000
tokens_out: 6200
elapsed_ms: 180000
estimated_human_hours: 2.5
compaction_occurred: false
---

## Summary

Wired the missing ACCEPTED→ARCHIVED lifecycle transition into the orchestrator. Three new functions added to `bridge/orchestrator.js` (174 LOC):

1. **`archiveAcceptedSlice(id, branchName, opts)`** — Renames `{id}-ACCEPTED.md` → `{id}-ARCHIVED.md`, prunes worktree, deletes branch, emits `ARCHIVED` register event with `{ ts, slice_id, event, branch, sha, source }`. Idempotent.

2. **`archiveSiblingStateFiles(id, terminalState, opts)`** — Moves sibling state files (DONE, IN_PROGRESS, PARKED, EVALUATING, IN_REVIEW, ACCEPTED — excluding the terminal state file) to `bridge/trash/` with `.cleanup-{terminalState}-{ISO_date}` suffix. Emits `STATE_FILES_ARCHIVED` event listing moved files.

3. **`backfillArchive(opts)`** — One-shot startup pass guarded by `bridge/.backfill-archive-done` marker. Scans queue for ACCEPTED files whose branch is merged on main, transitions them via `archiveAcceptedSlice`. Emits `BACKFILL_ARCHIVE_COMPLETE { processed, skipped }`.

### Call sites

- **`handleAccepted` success path** (post-merge): calls `archiveAcceptedSlice(id, branchName)` wrapped in try/catch. Archival failure is logged warn but does not fail the merge.
- **`writeErrorFile`**: calls `archiveSiblingStateFiles(id, 'ERROR')` after ERROR file is written. Best-effort.
- **Startup**: `backfillArchive()` called alongside `restagedBootstrap()`.

### Backfill count

0 slices archived by backfill — no `-ACCEPTED.md` files remain on main (Worf's ad-hoc ghost archive pass on 2026-04-25 already moved them). The backfill guard ensures this is a no-op on subsequent startups.

### Tests

12/12 pass in `test/orchestrator-lifecycle-archive.test.js` (tests A–J per spec, plus 2 event-schema checks).

### AC checklist

- AC1 ✓ `archiveAcceptedSlice` exists, idempotent, emits ARCHIVED event
- AC2 ✓ `mergeBranch` calls it post-MERGED, wrapped in try/catch
- AC3 ✓ Queue contains only ARCHIVED after merge (siblings cleaned)
- AC4 ✓ `archiveSiblingStateFiles` exists, moves to trash with cleanup suffix
- AC5 ✓ `writeErrorFile` calls sibling cleanup after ERROR write
- AC6 ✓ `backfillArchive` exists, marker-guarded, processes merged ACCEPTED files
- AC7 ✓ ARCHIVED event has all required fields including source
- AC8 ✓ No changes to merge logic itself
- AC9 ✓ Tests A–J pass
- AC10 ✓ 174 LOC added (under ~250 limit)
- AC11 ✓ Changes only in orchestrator.js + test file
- AC12 ✓ Backfill count: 0 (documented above)
