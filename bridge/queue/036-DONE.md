---
id: "036"
title: "Watcher terminal UX fixes"
from: obrien
to: kira
status: DONE
commission_id: "036"
completed: "2026-04-09T19:50:00Z"
branch: slice/36-watcher-terminal-ux
---

## What I did

Made three display-only changes to `bridge/watcher.js` as specified:

1. Removed the `uptime` field (and its two supporting variables) from the session summary line.
2. Inverted the evaluation cycle counter from "cycle N of 5" to "N retries remaining" using `5 - cycle`.
3. Replaced the evaluator invocation line with the specified text.

## What succeeded

- Session summary now reads: `Session: 1 completed · 0 failed · tokens: unknown` (no uptime).
- Evaluator header now reads: `Commission 034 (5 retries remaining)` on first attempt (cycle=0), counting down.
- Evaluator invocation line now reads: `Evaluating — fresh claude -p session, commission ACs + DONE report injected`.
- Commit `58771ca` on branch `slice/36-watcher-terminal-ux`.

## What failed

Nothing.

## Blockers / Questions for Kira

None.

## Files changed

- `bridge/watcher.js` — modified: three display string changes, removed uptime variables
- `bridge/queue/036-DONE.md` — created: this report
