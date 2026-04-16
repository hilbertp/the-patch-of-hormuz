---
id: "090"
title: "Wormhole writer-split migration"
from: obrien
to: kira
status: DONE
slice_id: "090"
branch: "slice/090"
completed: "2026-04-16T02:25:00.000Z"
tokens_in: 85000
tokens_out: 12000
elapsed_ms: 480000
estimated_human_hours: 2.0
compaction_occurred: false
---

## Summary

Migrated `bridge/timesheet.jsonl`, `bridge/anchors.jsonl`, and `bridge/tt-audit.jsonl` to a writer-split model. Each writer now appends to its own per-role file (e.g. `timesheet-watcher.jsonl`, `timesheet-kira.jsonl`). The watcher rebuilds merged views on any change.

## What was done

### 1. Migration script (`bridge/scripts/migrate-writer-split.js`)
- One-shot, idempotent migration that copies existing entries to `-watcher.jsonl` files
- Verified: 20 timesheet lines, 10 anchors lines migrated; tt-audit was empty
- Running twice safely skips already-migrated files

### 2. `bridge/slicelog.js` updated
- `appendTimesheet()` now writes to `timesheet-watcher.jsonl` (was `timesheet.jsonl`)
- `updateTimesheet()` now reads/writes `timesheet-watcher.jsonl`
- Both call `rebuildMerged('timesheet')` after every write
- New `rebuildMerged(base)` utility: reads all `bridge/{base}-*.jsonl`, sorts by `ts`, writes merged `bridge/{base}.jsonl`

### 3. `bridge/watcher.js` updated
- Imports `rebuildMerged` from slicelog
- Added `fs.watch` on `bridge/` directory at startup — when any `{base}-*.jsonl` file changes (e.g. Kira appending via Wormhole), debounces and rebuilds the merged view

### 4. `bridge/usage-snapshot.js` updated
- Writes to `timesheet-watcher.jsonl` instead of `timesheet.jsonl`
- Calls `rebuildMerged('timesheet')` after appending

### 5. Skills updated
- `skills/wrap-up/SKILL.md`: Steps 3 and 6 now instruct roles to append to `timesheet-{role}.jsonl` and `anchors-{role}.jsonl` via `wormhole_append_jsonl`
- `skills/handoff-to-teammate/SKILL.md`: Steps 1c, 2, and 3 updated to target per-role files (`tt-audit-{role}.jsonl`, `timesheet-{role}.jsonl`, `anchors-{role}.jsonl`)

### 6. Dashboard verified
- `dashboard/server.js` reads economics from `bridge.log` events, not from `timesheet.jsonl` directly — no changes needed

## Files changed
- `bridge/scripts/migrate-writer-split.js` (new)
- `bridge/timesheet-watcher.jsonl` (new, 20 lines)
- `bridge/anchors-watcher.jsonl` (new, 10 lines)
- `bridge/tt-audit-watcher.jsonl` (new, empty)
- `bridge/slicelog.js` (writer-split + rebuildMerged)
- `bridge/watcher.js` (fs.watch for external JSONL changes)
- `bridge/usage-snapshot.js` (write to -watcher.jsonl)
- `.claude/skills/wrap-up/SKILL.md` (per-role file paths)
- `.claude/skills/handoff-to-teammate/SKILL.md` (per-role file paths)

## Success criteria check
1. Migration script exists and runs without error — **PASS**
2. `timesheet-watcher.jsonl` contains all 20 pre-migration entries — **PASS**
3. `slicelog.js` writes to `timesheet-watcher.jsonl` — **PASS**
4. Watcher rebuilds `timesheet.jsonl` after any `timesheet-*.jsonl` change — **PASS** (fs.watch + debounce)
5. Wrap-up skill instructs Kira to append to `timesheet-kira.jsonl` — **PASS**
6. Ops Center still shows economics (reads from events, not timesheet) — **PASS**
7. Committed on `slice/090` — **PASS**

## Notes
- Original merged files are preserved as rebuild targets (not deleted)
- The `fs.watch` approach uses a 200ms debounce to handle rapid successive change events
- No external dependencies added — `rebuildMerged` uses `fs.readdirSync` instead of `glob`
