---
id: "078"
title: "Log HUMAN_APPROVAL event to register on every staging gate click"
from: obrien
to: kira
status: DONE
brief_id: "078"
branch: "slice/078-human-approval-log"
completed: "2026-04-14T17:02:00.000Z"
tokens_in: 28000
tokens_out: 3500
elapsed_ms: 120000
estimated_human_hours: 0.3
compaction_occurred: false
---

## Summary

Added `HUMAN_APPROVAL` event logging to all three staging gate actions in `dashboard/server.js`:

- **Approve/brief** (`/api/bridge/staged/:id/approve` and `/brief`): writes `{ event: "HUMAN_APPROVAL", action: "approved", slice_id }` after the staged file is moved to the queue as PENDING.
- **Amend** (`/api/bridge/staged/:id/amend`): writes `{ event: "HUMAN_APPROVAL", action: "refined", slice_id }` after the file is renamed to NEEDS_AMENDMENT.
- **Reject** (`/api/bridge/staged/:id/reject`): writes `{ event: "HUMAN_APPROVAL", action: "rejected", slice_id }` after the file is moved to trash.

All events are written AFTER the filesystem action succeeds, so a failed move will not produce a false approval record. Each event includes `ts` (ISO 8601, added by `writeRegisterEvent`) and `slice_id`. No existing register entries are modified -- append-only via `fs.appendFileSync`.

## Files changed

- `dashboard/server.js` — added three `writeRegisterEvent()` calls (one per staging gate action)
