---
id: "246"
title: "F-WI — Fix stale elapsed timer: add pickup_ts to heartbeat so dashboard resets on restart"
from: rom
to: nog
status: DONE
slice_id: "246"
branch: "slice/246"
completed: "2026-04-28T08:25:00.000Z"
tokens_in: 45000
tokens_out: 4500
elapsed_ms: 180000
estimated_human_hours: 0.3
compaction_occurred: false
---

## Summary

Fixed the stale elapsed timer bug where the dashboard showed 934m elapsed after an orchestrator restart on the same slice. Root cause: `sliceStartTime` was only re-anchored when `mission.id` changed, but a restart resets `slice_elapsed_seconds` to ~0 without changing the slice ID.

## Changes

### `bridge/orchestrator.js`
- Added `pickup_ts` field to the heartbeat snapshot in `writeHeartbeat()`. Emits the ISO timestamp of `heartbeatState.pickupTime` when processing, `null` when idle.

### `dashboard/lcars-dashboard.html`
- Added `lastPickupTs` module-level variable alongside `sliceStartTime` and `lastSliceId`.
- Extended the timer re-anchor condition: now also triggers when `heartbeat.pickup_ts` changes (detecting orchestrator restarts on the same slice).
- Reset `lastPickupTs` to `null` in the idle branch for clean state.

## Commits

1. `0d4025a` — chore: add pickup_ts stub to heartbeat and lastPickupTs to dashboard (skeleton)
2. `6fd3a11` — fix: reset elapsed timer on orchestrator restart via pickup_ts (implementation)

## Acceptance criteria

- [x] AC1. Two commits minimum — skeleton + implementation
- [x] AC2. `pickup_ts` field present in heartbeat whenever a slice is being processed
- [x] AC3. `pickup_ts` is null when orchestrator is idle (`heartbeatState.pickupTime` is null)
- [x] AC4. Dashboard resets elapsed timer when `pickup_ts` changes for the same slice ID
- [x] AC5. Timer displays correctly (~seconds) immediately after restart — re-anchored from fresh `slice_elapsed_seconds`
- [x] AC6. Changes only in `bridge/orchestrator.js` and `dashboard/lcars-dashboard.html`
