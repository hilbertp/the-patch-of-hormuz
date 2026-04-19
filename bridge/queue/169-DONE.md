---
id: "169"
title: "Delete orphaned callReviewAPI function (post-168 cleanup)"
from: rom
to: nog
status: DONE
slice_id: "169"
branch: "slice/169"
completed: "2026-04-19T15:16:10.000Z"
tokens_in: 28000
tokens_out: 3500
elapsed_ms: 95000
estimated_human_hours: 0.1
compaction_occurred: false
---

## Summary

Deleted the orphaned `callReviewAPI` function from `bridge/watcher.js`. The function (lines 2067-2094, ~28 lines including JSDoc header) was left behind when slice 168 removed all four call sites. No other cleanup was needed — the function used a scoped `require('http')` so no module-level imports became orphaned.

## Acceptance criteria

| AC | Status | Evidence |
|----|--------|----------|
| 1. `grep callReviewAPI` returns zero hits | PASS | 0 matches after edit |
| 2. `node bridge/watcher.js` starts cleanly | PASS | Watcher started, polled queue, exited cleanly on SIGTERM |
| 3. Full test suite passes | N/A | No test script configured in this project |
| 4. Events in canonical order (dev->review->accept->merge) | DEFERRED | Observable after end-to-end pipeline run |
| 5. ACCEPTED event has no `reason` field | DEFERRED | Observable after end-to-end pipeline run |
| 6. `git diff --stat` shows one file, ~-30 lines | PASS | `bridge/watcher.js` -29 lines |

## Changes

- `bridge/watcher.js`: Deleted `callReviewAPI` function definition and JSDoc comment block (29 lines removed, 0 added).

## Notes

- No top-of-file import cleanup was needed. The function used `require('http')` locally scoped inside the function body.
- No other helpers were referenced exclusively by `callReviewAPI`.
- ACs 4 and 5 relate to pipeline event ordering from slice 168's fix — they will be observable in register.jsonl after this slice completes its full end-to-end run through the pipeline.
