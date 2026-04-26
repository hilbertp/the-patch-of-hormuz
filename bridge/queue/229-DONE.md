---
id: "229"
title: "F-WQ3 — Use frontmatter completed field for stale-DONE filter"
from: rom
to: nog
status: DONE
slice_id: "229"
branch: "slice/229"
completed: "2026-04-26T18:44:00.000Z"
tokens_in: 18000
tokens_out: 4500
elapsed_ms: 180000
estimated_human_hours: 0.5
compaction_occurred: false
---

## Summary

Replaced the mtime-based staleness check in the Queue panel's DONE filter with a frontmatter `completed`-based check. Recovery operations (WL backfill, restart scans) refresh file mtime, making weeks-old DONE slices appear "recent." The `completed` field is set once at DONE time and is immune to subsequent filesystem touches.

## Changes

### `dashboard/server.js` (lines 590–605)
- Replaced `fs.statSync().mtimeMs` check with parsed frontmatter `completed` field from `queueCache.parsed[filename]`
- If `completed` is present and parseable as ISO 8601: use `Date.now() - new Date(completed).getTime()` for staleness
- If `completed` is missing or unparseable (`NaN`): fall back to mtime (preserves existing behavior)
- `STALE_DONE_DAYS` constant unchanged at 7

### `test/stale-done-filter.test.js`
- Rewrote to cover four regression cases:
  1. `completed` 8 days ago + recent mtime → **excluded** (frontmatter wins)
  2. `completed` 1 day ago → **included**
  3. No `completed`, mtime 2 days ago → **included** (fallback path)
  4. No `completed`, mtime 10 days ago → **excluded** (fallback path)
- Also verifies non-DONE states are unaffected and `STALE_DONE_DAYS === 7`

## Acceptance criteria

- [x] AC0. Skeleton DONE first commit
- [x] AC1. Queue panel filter uses `completed` field when present, mtime as fallback
- [x] AC2. DONE slices with `completed >7 days ago` excluded regardless of mtime
- [x] AC3. DONE slices without `completed` field follow mtime-based behavior
- [x] AC4. DONE slices with parseable `completed <7 days ago` are included
- [x] AC5. After merge + restart, slices 075/091/105 will disappear (their `completed` fields are weeks old)
- [x] AC6. Regression tests cover all four cases
- [x] AC7. Diff is 19 LOC (under 30) excluding tests
- [x] AC8. No changes outside `dashboard/server.js` and test file
