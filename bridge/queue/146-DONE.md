---
id: "146"
title: "watcher+dashboard: rename queue suffix PENDING to QUEUED with dual-accept"
from: rom
to: nog
status: PARTIAL
slice_id: "146"
branch: "slice/146"
completed: "2026-04-17T00:12:00.000Z"
tokens_in: 52000
tokens_out: 8000
elapsed_ms: 360000
estimated_human_hours: 1.0
compaction_occurred: false
---

## Summary

Renamed the on-disk queue suffix from `-PENDING.md` to `-QUEUED.md` across the watcher and dashboard, with dual-accept migration so in-flight legacy files continue to work.

## Status: PARTIAL

**Task 6 skipped:** `docs/contracts/slice-format.md` does not exist on `main`. Slice 148 (which creates this file) has not landed yet. Per the brief's dependency note, this task is deferred until slice 148 merges.

All other tasks (1–5, 7–8) are complete.

## Changes

### `bridge/watcher.js`
- **Write sites (Tasks 1–2):** All 6 write sites now produce `-QUEUED.md` with `status: QUEUED`:
  - Rate-limit requeue
  - API-error retry requeue
  - Evaluator amendment slice
  - Nog return amendment slice (frontmatter + filename)
  - Startup recovery orphan requeue
- **Read sites (Task 3):** All scan/filter sites dual-accept both `-QUEUED.md` and `-PENDING.md`:
  - `getQueueSnapshot()` waiting count
  - Poll loop `pendingFiles` filter
  - Slice ID derivation regex
- Log messages and comments updated to use QUEUED as the state label.
- 38 QUEUED references, 8 PENDING references (all read-side dual-accept).

### `dashboard/server.js`
- **Approve endpoint (Task 4):** Writes `-QUEUED.md` with `status: QUEUED`.
- **Filename regex:** Extended to `(PENDING|QUEUED|IN_PROGRESS|DONE|ERROR)`, both PENDING and QUEUED map to `queue.waiting++`.
- **Unaccept path:** Tries `-QUEUED.md` first, falls back to `-PENDING.md`.
- **Queue content fallback reads:** Added `-QUEUED.md` before `-PENDING.md` in candidate list.
- 7 QUEUED references, 6 PENDING references (all read-side dual-accept).

### `docs/contracts/slice-pipeline.md`
- §4 state-suffix table: row 2 now shows `-QUEUED.md` with migration note.
- §5 transition table: updated STAGED→QUEUED and QUEUED→IN_PROGRESS descriptions.
- §9: updated reference from `-PENDING.md` to `-QUEUED.md`.
- §12 item 1: marked as resolved in slice 146 with dual-accept note.

## Acceptance criteria verification

| Criterion | Result |
|---|---|
| `grep -c QUEUED bridge/watcher.js` ≥ 20 | 38 ✓ |
| `grep -c QUEUED dashboard/server.js` ≥ 4 | 7 ✓ |
| `grep -c PENDING bridge/watcher.js` ≥ 5 | 8 ✓ |
| `grep -c PENDING dashboard/server.js` ≥ 2 | 6 ✓ |
| No template-literal writes of `-PENDING.md` in watcher | 0 ✓ |
| No `status: PENDING` writes anywhere | 0 ✓ |
| §4 row 2 says `-QUEUED.md` | ✓ |
| §12 item 1 mentions "slice 146" and "resolved" | ✓ |
| `node -c bridge/watcher.js` exits 0 | ✓ |
| `node -c dashboard/server.js` exits 0 | ✓ |
| `slice-lifecycle.md` untouched | ✓ |
| `slice-format.md` updated | ⏭ Skipped (file does not exist; slice 148 dependency) |
