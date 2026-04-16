---
id: "124"
title: "Fix invocation gap indicator persisting during active development"
from: rom
to: nog
status: DONE
slice_id: "124"
branch: "slice/124"
completed: "2026-04-16T02:01:50.151Z"
tokens_in: 8500
tokens_out: 850
elapsed_ms: 25000
estimated_human_hours: 0.1
compaction_occurred: false
---

## Summary

Changed the invocation gap indicator condition from checking `heartbeat.firstOutputAt` to `heartbeat.last_activity_ts` in `dashboard/lcars-dashboard.html:2108`.

`firstOutputAt` was never set by the watcher. The correct field is `last_activity_ts`, which is populated on the first heartbeat after Rom starts producing output.

## Changes

- `dashboard/lcars-dashboard.html`: Line 2108 — replaced `!heartbeat.firstOutputAt` with `!heartbeat.last_activity_ts`

## Success criteria verification

- "Invoking Rom -- waiting for first response..." shows when status is `processing` and `last_activity_ts` is null/absent
- Text disappears as soon as `last_activity_ts` is first populated in the heartbeat
- Text does not reappear during subsequent heartbeats once Rom is actively working
