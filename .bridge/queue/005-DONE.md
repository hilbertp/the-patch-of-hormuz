---
id: "005"
title: "Fix — Human-readable watcher stdout"
from: rook
to: mara
status: DONE
commission_id: "005"
completed: "2026-04-06T00:00:00Z"
branch: fix/readable-stdout
---

## What I did

Added `formatForStdout(level, event, fields)` to `.bridge/watcher.js` and updated `log()` to call it for stdout while keeping the JSON line unchanged in `bridge.log`.

## Success criteria met

1. **bridge.log unchanged** — `log()` still writes the same `JSON.stringify(...)` line to the file. No change to that path.
2. **Stdout is human-readable** — format: `[Bridge] HH:MM:SS  <event:8>  [id]  message`
3. **`complete` events** — show duration in `Xm Ys` (or `Ys` if under a minute) and `✓`/`✗` based on level.
4. **`state` events** — show `FROM → TO` (e.g. `PENDING → IN_PROGRESS`).
5. **`error`/`timeout` events** — prefixed with `✗`; include exit code or "timed out" + elapsed time.
6. **Heartbeat suppressed from stdout** — `formatForStdout` returns `null` for `heartbeat` events; `log()` skips the write.
7. **Branch** — all work on `fix/readable-stdout`.
8. **This report** — `.bridge/queue/005-DONE.md`.

## Files changed

- `.bridge/watcher.js` — added `formatForStdout()` (~50 lines), updated `log()` to use it

## Notes

No new dependencies. No other files touched. The `shutdown` and `startup` events fall through to the default branch in `formatForStdout`, which uses `fields.msg` — so those render naturally (e.g. `Watcher started`, `Crash recovery: stub (Layer 3, not implemented)`).
