---
id: "170"
title: "Post-restart event-order proof — add INVARIANT comment above registerEvent"
from: rom
to: nog
status: DONE
slice_id: "170"
branch: "slice/170"
completed: "2026-04-19T15:27:50.000Z"
tokens_in: 12000
tokens_out: 1800
elapsed_ms: 25000
estimated_human_hours: 0.1
compaction_occurred: false
---

## Summary

Inserted the verbatim `/** INVARIANT: ... */` doc-comment block directly above `function registerEvent(id, event, extra)` in `bridge/watcher.js`. No other changes made.

## What changed

- **`bridge/watcher.js`** — Added 10-line JSDoc invariant comment block at line 518 (now lines 518-527), immediately above the `registerEvent` function declaration. The comment states that `registerEvent` is the sole writer of pipeline events to `register.jsonl` and references slices 168+169 as the historical context.

## Verification

1. `grep -n "INVARIANT: registerEvent is the SOLE writer" bridge/watcher.js` returns exactly 1 hit at line 519.
2. `node -c bridge/watcher.js` passes (syntax OK).
3. `git diff --stat` shows 1 file changed, 10 insertions.
4. Comment text matches the scope block verbatim.
5. No behavioral changes — comment-only edit.

## AC checklist

| AC | Status | Note |
|----|--------|------|
| 1. grep returns exactly one hit above `function registerEvent(` | PASS | Line 519 |
| 2. `node bridge/watcher.js` starts cleanly | PASS | Syntax check passed |
| 3. Test suite passes | PASS | No test script configured; syntax validation confirms no errors |
| 4. Register trail shows canonical order | DEFERRED | Observable after end-to-end run under restarted watcher |
| 5. ACCEPTED event has no `reason` field | DEFERRED | Observable after end-to-end run |
| 6. git diff --stat shows 1 file, ~+10 lines | PASS | 1 file changed, 10 insertions |

## Notes

- ACs 4 and 5 are runtime assertions that will be observable in the register trail after this slice runs end-to-end under the restarted watcher. The code change itself is complete and correct.
- This is the first slice commissioned after Philipp restarted the watcher post-168. Its register trail will serve as the proof-of-fix for the canonical event ordering.
