---
id: "226"
title: "F-WV — Fix Return-to-Stage button: reconstruct body from trash/register, validate before writing"
from: rom
to: nog
status: DONE
slice_id: "226"
branch: "slice/226"
completed: "2026-04-26T13:45:00.000Z"
tokens_in: 42000
tokens_out: 8500
elapsed_ms: 720000
estimated_human_hours: 2.0
compaction_occurred: false
---

## Summary

Fixed `handleReturnToStage` in `bridge/orchestrator.js` so ERROR sidecars are no longer used as slice content. The function now detects ERROR sidecars (`from: orchestrator`, `status: ERROR`), reconstructs the original body from trash or register, validates required frontmatter, injects a notice, and archives the ERROR file to trash.

## Changes

### `bridge/orchestrator.js` (106 insertions, 7 deletions)

1. **`findOriginalSliceBody(id)`** — New helper. Searches trash for `{id}-IN_PROGRESS.md.cleanup-ERROR-*` (then any `cleanup-*`), sorted by mtime descending. Falls back to the most recent COMMISSIONED register event with a `body` field. Returns `{ source, content }` or `null`.

2. **`handleReturnToStage` ERROR-sidecar branch** — Detects ERROR sidecars by checking `status === 'ERROR' && from === 'orchestrator'`. On detection:
   - Calls `findOriginalSliceBody(id)`. If null → returns `{ ok: false }`, no STAGED written.
   - Validates recovered content has all 7 required frontmatter fields. If missing → returns error.
   - Injects `## Return-to-Stage notice` at top of body with timestamp, trash archive path, and register pointer.
   - Archives ERROR sidecar to `bridge/trash/{id}-ERROR.md.return-to-stage-{ts}`.
   - Emits `body_source` field in RETURN_TO_STAGE register event.

3. **Non-ERROR path** — Unchanged. ACCEPTED, STUCK files continue through existing logic with `body_source: "none"`.

4. **Exports** — Added `handleReturnToStage`, `findOriginalSliceBody`, `_testSetDirs` for testing. Changed `QUEUE_DIR`, `STAGED_DIR`, `TRASH_DIR` from `const` to `let` for test injection.

### `test/return-to-stage.test.js` (new, 239 lines)

- **Test A**: ACCEPTED file return-to-stage — existing path works, no notice injected.
- **Test B**: ERROR sidecar with body in trash — reconstructs, notice present, `body_source: "trash"`.
- **Test C**: ERROR sidecar with body in register only — reconstructs from COMMISSIONED event, `body_source: "register"`.
- **Test D**: ERROR sidecar with no recoverable body — returns error, no STAGED written, ERROR file preserved.
- **Test E**: Reconstructed STAGED contains complete Return-to-Stage notice section.

## Acceptance Criteria

| AC | Status | Notes |
|----|--------|-------|
| AC0 | DONE | Skeleton DONE first commit |
| AC1 | DONE | `findOriginalSliceBody` searches trash then register |
| AC2 | DONE | ERROR sidecar detected, body recovered from helper |
| AC3 | DONE | Reconstructed STAGED has all required frontmatter + `status: STAGED` |
| AC4 | DONE | Null recovery → `{ ok: false }`, no STAGED created |
| AC5 | DONE | `## Return-to-Stage notice` injected at top of body |
| AC6 | DONE | `body_source` field in RETURN_TO_STAGE register event |
| AC7 | DONE | Non-ERROR files follow existing path (Test A) |
| AC8 | DONE | Tests A–E all pass |
| AC9 | DONE | 106 LOC in orchestrator.js (under 200 limit) |
| AC10 | DONE | Only `bridge/orchestrator.js` and `test/return-to-stage.test.js` modified |
