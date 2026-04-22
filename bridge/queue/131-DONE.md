---
id: "131"
title: "F-131 — Persist drag-reorder for queue and staged panels"
from: rom
to: nog
status: DONE
slice_id: "131"
branch: "slice/131"
completed: "2026-04-22T06:08:00.000Z"
tokens_in: 28000
tokens_out: 4500
elapsed_ms: 120000
estimated_human_hours: 1.0
compaction_occurred: false
---

## Summary

Implemented full drag-reorder persistence for both queue and staged panels in the Ops Center dashboard.

## Changes

### Task 1: POST `/api/queue/order` route
- Added route in `dashboard/server.js` that accepts `{ order: [...ids] }`, validates the array, and calls `writeQueueOrder()`.

### Task 2: Staged-order.json persistence
- **Server**: Added `STAGED_ORDER` constant, `readStagedOrder()`/`writeStagedOrder()` helpers mirroring queue-order pattern.
- **Server**: Included `stagedOrder: readStagedOrder()` in bridge API response.
- **Server**: Added POST `/api/staged/order` route (same pattern as queue/order).
- **Frontend**: On staged drag-drop, POST to `/api/staged/order` to persist.
- **Frontend**: On poll, seed `cachedStagedOrder` from `bridgeData.stagedOrder` (with merge logic for new/removed items).

### Task 3: Prevent poll from clobbering in-flight drag
- Wrapped both `cachedQueueOrder` and `cachedStagedOrder` updates in `fetchCombinedQueue()` with `if (!dragSrcId)` guard, so the 5-second poll won't revert order while a drag is in progress.

## Files modified
- `dashboard/server.js` — new constant, helpers, two POST routes, stagedOrder in API response
- `dashboard/lcars-dashboard.html` — staged POST on drop, server-seeded staged order, dragSrcId guard

## Verification
- Queue drag-reorder persists via `bridge/queue-order.json` (existing) + new POST route
- Staged drag-reorder persists via `bridge/staged-order.json` (new) + new POST route
- Mid-drag poll skip prevents 5-second revert
