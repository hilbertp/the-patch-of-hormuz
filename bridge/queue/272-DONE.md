---
id: "272"
title: "F-Ops-RemoveQueue — wire missing /api/queue/:id/remove + add Un-approve modal button"
from: rom
to: nog
status: DONE
slice_id: "272"
branch: "slice/272"
completed: "2026-04-30T19:05:00.000Z"
tokens_in: 42000
tokens_out: 8500
elapsed_ms: 480000
estimated_human_hours: 1.5
compaction_occurred: false
---

## Summary

Implemented the missing `POST /api/queue/:id/remove` archive route and added an explicit Un-approve button to the slice-detail modal.

## Changes

### 1. `POST /api/queue/:id/remove` — `dashboard/server.js`

New route placed after the existing `/api/slice/:id/unapprove` handler. Behavior:

- **409** if `heartbeat.json.current_slice === id` (race protection)
- **404** if `bridge/queue/{id}-QUEUED.md` doesn't exist
- Removes id from `queue-order.json`
- Moves QUEUED file to `bridge/trash/{id}-QUEUED.md.removed-{timestamp}`
- Emits `slice-archived-from-queue` register event via `writeRegisterEvent`
- Returns `{"ok":true,"action":"archived"}`

### 2. Un-approve button — `dashboard/lcars-dashboard.html`

- Added ghost-style `Un-approve` button before the destructive `Remove from queue` button in the queued-slice action footer
- Implemented `sliceDetailUnapprove()` mirroring `sliceDetailApprove` — calls `POST /api/slice/:id/unapprove`, closes modal, refreshes queue/bridge on success, alerts on 409

### 3. Tests (all pass)

| Test file | Assertions |
|---|---|
| `test/api-queue-remove.test.js` | 200 response, file moved to trash, queue-order updated, register event |
| `test/api-queue-remove-404.test.js` | 404 for non-existent id |
| `test/api-queue-remove-active-409.test.js` | 409 when heartbeat has current_slice |
| `test/slice-detail-unapprove-button.test.js` | Button exists, correct label, correct position, function defined, calls correct API, not destructive-styled |

## Files changed

- `dashboard/server.js` — new archive route
- `dashboard/lcars-dashboard.html` — Un-approve button + handler
- `test/api-queue-remove.test.js` — archive happy path
- `test/api-queue-remove-404.test.js` — 404 test
- `test/api-queue-remove-active-409.test.js` — 409 race protection test
- `test/slice-detail-unapprove-button.test.js` — DOM render test
- `bridge/queue/272-DONE.md` — this report
