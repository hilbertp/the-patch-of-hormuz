---
id: "203"
title: "F-203 — Ops Queue panel: filter out terminal slices (ACCEPTED/ARCHIVED) from queue render"
from: rom
to: nog
status: DONE
slice_id: "203"
branch: "slice/203"
completed: "2026-04-24T13:15:00.000Z"
tokens_in: 42800
tokens_out: 8600
elapsed_ms: 1980000
estimated_human_hours: 1.5
compaction_occurred: false
---

## Summary

Queue panel now shows only non-terminal slices. The ~78 merged Sprint 3 DONE files no longer flood the operator view.

## Changes

### `dashboard/server.js` (backend, +18 LOC)

`buildBridgeData()` now builds a `terminalIds` set from two sources before processing queue files:

1. **MERGED register events** — any slice whose ID appears in a `MERGED` event is terminal.
2. **Filesystem markers** — any file matching `{id}-(ACCEPTED|ARCHIVED|SLICE).md` in `bridge/queue/` marks that ID as terminal.

Any DONE (or other state) file whose `rawId` is in `terminalIds` is skipped. This excludes all ~78 merged Sprint 3 slices from `slices` at the API level.

### `dashboard/lcars-dashboard.html` (frontend, +5 LOC)

`buildQueueRows()` now builds `mergedIds` from `cachedRegisterEvents` (already available in scope) and adds `&& !mergedIds.has(String(b.id))` to the DONE row filter. This is a defensive guard — if the backend ever leaks a terminal DONE slice, the frontend won't render it in Queue.

### `test/queue-render.test.js` (new, 208 LOC)

6 regression tests covering:
1. Filesystem ACCEPTED/ARCHIVED markers exclude slices from queue
2. MERGED register events alone exclude DONE slices (no marker file needed)
3. No terminal signals → all slices included (passthrough)
4. Frontend defensive filter hides MERGED DONE slices
5. Frontend filter is a no-op when no MERGED events exist
6. History (built from register DONE events) still includes all 5 synthetic slices

## Acceptance criteria

- [x] AC 0: DONE skeleton first commit
- [x] AC 1: Merged slices (199, 198, …) absent from Queue panel
- [x] AC 2: History panel unaffected (register-based, independent of queue files)
- [x] AC 3: Backend `/api/bridge` `slices` array excludes terminal IDs
- [x] AC 4: Frontend Queue render filters defensively via `cachedRegisterEvents`
- [x] AC 5: Regression test with 5-state synthetic seed (3 queue, 2 terminal)
- [x] AC 6: Full suite passes (18 test files, all green)
- [x] AC 7: No `bridge/*` modifications outside test files
- [x] AC 8: Diff 27 LOC on source files (well under 150)

## Notes

- No ACCEPTED/ARCHIVED marker files currently exist in `bridge/queue/` — the real-world fix works via MERGED events in `register.jsonl` (which exists only in the main working tree, not this worktree). Both mechanisms are active for belt-and-suspenders.
- Queue panel CSS and layout unchanged.
- `Return` button behavior on legitimately non-terminal DONE slices (awaiting Nog) is unchanged.
