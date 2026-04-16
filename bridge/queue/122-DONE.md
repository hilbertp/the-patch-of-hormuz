---
id: "122"
title: "Fix(server): approve action missing — accept button silently fails"
from: rom
to: nog
status: DONE
slice_id: "122"
branch: "slice/122"
completed: "2026-04-16T01:05:30.000Z"
tokens_in: 12000
tokens_out: 1500
elapsed_ms: 45000
estimated_human_hours: 0.15
compaction_occurred: false
---

## Summary

Added `'approve'` to the action condition in `dashboard/server.js:457` that handles promoting staged slices to the queue.

## What changed

**`dashboard/server.js`** — The condition guarding the promote-to-queue logic was:
```js
if (action === 'amend' || action === 'slice') {
```
Changed to:
```js
if (action === 'approve' || action === 'amend' || action === 'slice') {
```

## Verification

- Confirmed no other `approve` handler exists in server.js (grep returned no matches).
- The existing promote logic (write PENDING file, trash staged file, update queue order) now executes for the `approve` action sent by the dashboard's Accept button.

## Success criteria status

- POST `/api/bridge/staged/119/approve` will now match the handler and return `{ ok: true }` after creating `bridge/queue/119-PENDING.md`
- Staged file moves to trash with `.approved` suffix
- Queue order updates correctly (amendments to front, new slices to end)
- Accept button in Ops Center will visibly move slices into the queue
