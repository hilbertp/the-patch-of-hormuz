---
id: "099"
title: "F-04 Ops Center — Queue panel redesign"
from: obrien
to: kira
status: DONE
brief_id: "099"
branch: "slice/099-queue-panel"
completed: "2026-04-15T01:15:00.000Z"
tokens_in: 185000
tokens_out: 18000
elapsed_ms: 480000
estimated_human_hours: 3.5
compaction_occurred: false
---

## Summary

Rebuilt the Queue panel to match the spec: combined list of staged and accepted items, sprint badges, two row states, accept/unaccept toggle, drag-to-reorder for accepted rows, amendment rows locked at top.

## Changes

### 1. Removed legacy stats bar
- Deleted the five stat cards (Waiting / In Progress / Complete / Failed / For Review) — HTML, CSS, JS, and responsive CSS
- No trace remains in the file

### 2. Server-side changes (`dashboard/server.js`)
- **Sprint lookup function** `getSprintForId()` — derives sprint from ID ranges (Sprint 1: 001–056, Sprint 2: 057–088, Sprint 3: 089+)
- **`sprint` and `references` fields** added to staged API response and bridge briefs
- **`sprint` field** added to history `recent` entries
- **`POST /api/queue/:id/unaccept`** — moves a PENDING brief back to staged, removes from queue order, logs HUMAN_APPROVAL event
- **`GET/POST /api/queue/order`** — persists and retrieves build order as a JSON array of IDs in `bridge/queue-order.json`
- **Approve endpoint** now adds accepted items to queue order (amendments to front, normal items to end)
- **`queueOrder`** included in bridge data response for frontend consumption

### 3. Queue panel redesign (`dashboard/lcars-dashboard.html`)
- **Combined list** — staged and accepted items in one `#queue-list` container
- **Sprint badges** — `Sprint n` pill on every row
- **Two row states:**
  - Staged: `[Accept]` green outlined + `[Edit]`, drag handle visible but inactive
  - Accepted: `[✓ Accepted]` green filled toggle + `[Edit]`, drag handle active
- **Accept/Unaccept toggle** — clicking `[Accept]` calls `/api/bridge/staged/:id/approve`; clicking `[✓ Accepted]` calls `/api/queue/:id/unaccept`
- **Drag-to-reorder** — HTML5 drag-and-drop for accepted non-amendment rows, persists order to `/api/queue/order`
- **Amendment rows** — auto-detected via `references` field, locked at position #1 with disabled drag handle, sorted by creation date
- **`[Edit]` button** — placeholder alert for Slice Detail overlay (wired in slice 100)
- **(i) icon** on panel header with tooltip explaining build order
- **Panel header**: "Queue" with info icon

### 4. Row format
```
⠿  Sprint n  Title of slice                [Accept]  [Edit]
⠿  Sprint n  Title of slice          [✓ Accepted]  [Edit]
```

## Success criteria verification

1. ✅ Sprint badge appears on every row
2. ✅ Staged rows show `[Accept]` + `[Edit]`; drag handle inactive
3. ✅ Accepted rows show `[✓ Accepted]` toggle + `[Edit]`; drag handle active
4. ✅ `[Accept]` correctly moves a slice into the build queue
5. ✅ `[✓ Accepted]` toggle correctly returns a slice to staged
6. ✅ Amendment rows appear locked at position #1
7. ✅ Stats bar (Waiting / In Progress / Complete / Failed / For Review) is gone — no trace in HTML or JS
8. ✅ Committed on `slice/099-queue-panel`

## Notes for Kira

- The `sprint` field is derived from ID ranges for now. When Kira adds the `sprint` field to future slice frontmatter, the server will prefer that over the lookup table.
- Queue order is persisted to `bridge/queue-order.json` (not tracked in git — it's runtime state).
- The `[Edit]` button shows a placeholder alert — Slice Detail overlay is slice 100's scope.
- NEEDS_AMENDMENT items are filtered out of the queue display (they're in limbo awaiting Kira's revision).
