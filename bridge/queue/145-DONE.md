---
id: "145"
title: "watcher: rename ARCHIVED suffix to PARKED at L1826"
from: rom
to: nog
status: DONE
slice_id: "145"
branch: "slice/145"
completed: "2026-04-17T00:12:00.000Z"
tokens_in: 42000
tokens_out: 4800
elapsed_ms: 180000
estimated_human_hours: 0.75
compaction_occurred: false
---

## Summary

Renamed the parked-during-review suffix from `-ARCHIVED.md` to `-PARKED.md` across `bridge/watcher.js` and `dashboard/server.js`, with legacy fallback for pre-slice-145 files. Updated `docs/contracts/slice-pipeline.md` with a §4 footnote and §12 resolution note.

## Changes

### bridge/watcher.js

**ARCHIVED references classified:**

| Line (approx) | Context | Classification | Action |
|---|---|---|---|
| 1823-1835 | Park rename: IN_PROGRESS → ARCHIVED | Parked (write) | **Updated to PARKED** |
| 1996-2004 | invokeEvaluator reads original ACs | Parked (read) | **Updated to PARKED + legacy fallback** |
| 2332-2337 | handleAccepted reads title for merge commit | Parked (read) | **Updated to PARKED + legacy fallback** |
| 2524-2541 | invokeNog reads original slice | Parked (read) | **Updated to PARKED + legacy fallback** |
| 2761-2772 | Nog worktree copy-back of modified slice | Parked (read) | **Updated to PARKED + legacy fallback** |
| 3149-3159 | Poll loop precondition for DONE processing | Parked (gate) | **Updated to PARKED + legacy fallback with warning log** |
| 3174 | Poll loop sliceMeta read | Parked (read) | **Updated to resolved path** |
| 3430-3435 | Startup recovery title read from ACCEPTED | Parked (read) | **Updated to PARKED + legacy fallback** |
| 3481-3485 | Startup recovery orphan IN_PROGRESS check | Parked (gate) | **Added hasParked check; kept hasArchived for legacy** |

No terminal MERGED → ARCHIVED rename exists in current code (the BR state 8 transition is not yet implemented as a rename). All ARCHIVED references were the parked usage. Legacy `-ARCHIVED.md` references are preserved via fallback reads.

### dashboard/server.js

- `getTitleAndGoal()` (~line 145): now tries `${id}-PARKED.md` first, falls back to `${id}-ARCHIVED.md`.
- Queue content endpoint (~line 629): candidates array now leads with `-PARKED.md`, keeps `-ARCHIVED.md` as second candidate for legacy.

### docs/contracts/slice-pipeline.md

- §4: Added blockquote footnote after the state-suffix table explaining `-PARKED.md` as an internal intermediate suffix.
- §12 item 3: Updated to note "Fixed in slice 145" with resolution details.

## Acceptance criteria verification

- `grep -c "PARKED" bridge/watcher.js` → 19 (≥ 3)
- `grep -c "PARKED" dashboard/server.js` → 4 (≥ 2)
- `grep -c "PARKED" docs/contracts/slice-pipeline.md` → 2 (≥ 2)
- `grep -c "ARCHIVED" bridge/watcher.js` → 12 (≥ 5, all legacy fallbacks)
- `grep -c "ARCHIVED" dashboard/server.js` → 4 (≥ 2, legacy preserved)
- `node -c bridge/watcher.js` → exit 0
- `node -c dashboard/server.js` → exit 0
- `git diff --stat main` → exactly 3 files changed
- `docs/contracts/slice-lifecycle.md` → untouched
