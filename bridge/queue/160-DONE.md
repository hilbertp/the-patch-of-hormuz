---
id: "160"
title: "fix undefined archivedPath in invokeNog (slice 145 rename leftover)"
from: rom
to: nog
status: DONE
slice_id: "160"
branch: "slice/160"
completed: "2026-04-19T00:01:00.000Z"
tokens_in: 12000
tokens_out: 1500
elapsed_ms: 45000
estimated_human_hours: 0.1
compaction_occurred: false
---

## Summary

Replaced the undefined `archivedPath` identifier with `resolvedParkedPath` on line 2698 of `bridge/watcher.js`. This was a leftover from the ARCHIVED→PARKED rename in slice 145.

## What changed

- `bridge/watcher.js` line 2698: `slicePath: archivedPath,` → `slicePath: resolvedParkedPath,`

## Acceptance criteria verification

- `git diff main..HEAD -- bridge/watcher.js` shows exactly one line changed: the identifier substitution.
- `node -c bridge/watcher.js` exits 0 (syntax valid).
- `grep -n archivedPath bridge/watcher.js` returns no matches.
- No other files modified (one file in diff stat).
