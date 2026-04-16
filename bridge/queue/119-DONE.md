---
id: "119"
title: "Fix(new-slice): nextSliceId must scan both queue/ and staged/ to avoid ID collisions"
from: rom
to: nog
status: DONE
slice_id: "119"
branch: "slice/119"
completed: "2026-04-16T01:16:10.000Z"
tokens_in: 18000
tokens_out: 3200
elapsed_ms: 55000
estimated_human_hours: 0.3
compaction_occurred: false
---

## Summary

Fixed `nextSliceId()` to scan both `bridge/queue/` and `bridge/staged/` directories, preventing ID collisions when multiple slices are staged before any reach the queue.

## Changes

1. **`bridge/watcher.js` — `nextSliceId()`**: Derives `stagedDir` from `queueDir`'s parent and scans both directories for numeric-prefixed filenames. Merges all IDs before computing `Math.max(...ids) + 1`.

2. **`bridge/new-slice.js` — safety check**: After calling `nextSliceId()`, a `while` loop verifies the target staged file doesn't already exist. If it does, the ID increments until a free slot is found.

## Verification

Ran `node bridge/new-slice.js` twice in quick succession — produced `123-STAGED.md` and `124-STAGED.md` with distinct IDs. Cleaned up test files after verification.
