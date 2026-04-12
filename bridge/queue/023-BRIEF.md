---
id: "023"
title: "Smart timeout — activity-based kill"
goal: "Long-running commissions will no longer be killed if O'Brien is still producing output."
from: kira
to: obrien
priority: normal
created: "2026-04-09T13:40:00Z"
references: null
timeout_min: null
---

## Objective

This is Kira, your delivery coordinator. Replace the flat 15-minute kill timeout in the watcher with activity-based monitoring: kill a commission only if there has been no stdout activity for N minutes (configurable). The current flat timeout kills commissions that are slow but actively working.

## Context

**Current behavior:** `bridge/watcher.js` kills the `claude -p` child process after `timeoutMs` (default 900000 = 15 min, overridable per commission via `timeout_min` frontmatter). This is a wall clock timeout regardless of whether O'Brien is producing output.

**Problem:** Some commissions take longer than 15 minutes but are actively working — O'Brien is writing files, running tests, printing to stdout. Killing them wastes all progress and requires re-commissioning.

**Desired behavior:** The watcher tracks the timestamp of the last stdout/stderr output from the child process. If no output has been seen for `inactivityTimeoutMs` (configurable), kill the process. If output is flowing, never kill — there is no upper wall-clock limit as long as the process is active.

**Config location:** `bridge/bridge.config.json`

## Tasks

1. Add a new config key `inactivityTimeoutMs` to `bridge/bridge.config.json`. Default: 300000 (5 minutes of silence before kill). Document it with a comment in the code.

2. In `bridge/watcher.js`, modify the commission execution logic:
   - Track `lastActivityTs` — updated every time the child process writes to stdout or stderr.
   - Replace the existing wall-clock timeout with an inactivity check: on a regular interval (every 30 seconds), check if `Date.now() - lastActivityTs > inactivityTimeoutMs`. If yes, kill the child.
   - Remove or deprecate the old `timeoutMs` config key. If `timeoutMs` is still present in config, ignore it (log a one-time deprecation warning to bridge.log).
   - The per-commission `timeout_min` frontmatter field should now control `inactivityTimeoutMs` for that commission (overriding the global default). Rename semantics: `timeout_min` now means "minutes of inactivity before kill" rather than "total wall-clock minutes."

3. When killing due to inactivity, the ERROR file should include: `reason: "inactivity_timeout"`, `last_activity_seconds_ago: N`, and `inactivity_limit_minutes: N`.

4. Update the heartbeat to include `last_activity_ts` (ISO 8601) so the dashboard can show how recently O'Brien produced output.

5. Commit all changes on branch `slice/14-smart-timeout`.

## Constraints

- Only modify `bridge/watcher.js` and `bridge/bridge.config.json`.
- Do not change the watcher's polling behavior for new PENDING files — only the timeout logic for active commissions.
- Do not change the heartbeat file format beyond adding the new field.
- The watcher must still write ERROR files on kill — same format, just with the new reason fields.
- Backward compatible: if `inactivityTimeoutMs` is missing from config, default to 300000.

## Success criteria

1. `bridge.config.json` has `inactivityTimeoutMs` key (default 300000).
2. Watcher kills child process only after N ms of no stdout/stderr activity (not wall clock).
3. Active commissions producing output are never killed regardless of total elapsed time.
4. Per-commission `timeout_min` overrides the inactivity timeout for that commission.
5. ERROR file on inactivity kill includes `reason`, `last_activity_seconds_ago`, and `inactivity_limit_minutes`.
6. Heartbeat includes `last_activity_ts` field during active commissions.
7. Old `timeoutMs` config key is ignored with a deprecation warning logged once.
8. All changes committed on branch `slice/14-smart-timeout`.
