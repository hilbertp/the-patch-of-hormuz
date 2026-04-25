---
id: "194"
title: "F-194 — Ops Queue+History polish: Accepted pill + paginate history at 5"
from: rom
to: nog
status: DONE
slice_id: "194"
branch: "slice/194"
completed: "2026-04-23T10:50:00.000Z"
tokens_in: 19200
tokens_out: 4400
elapsed_ms: 2400000
estimated_human_hours: 0.5
compaction_occurred: false
---

## Summary

Two UX fixes to the Ops dashboard:
1. Approved-but-not-yet-running slices now show a non-interactive `✓ Accepted` pill instead of the clickable `[Accept]` button.
2. History panel now paginates at 5 entries per page.

Amendment round 1: removed two dead-code leftovers flagged by Nog — `.queue-btn-accepted` CSS and `queueUnaccept()` JS function (plus its matching server endpoint `/api/queue/{id}/unaccept`).

## Changes

### `dashboard/lcars-dashboard.html`
- `HISTORY_PAGE_SIZE = 5` (paginates history at 5 per page)
- Queue QUEUED-state action: `<span class="queue-accepted-pill">&#10003; Accepted</span>` (non-interactive pill)
- Added `.queue-accepted-pill` CSS: `cursor: default; user-select: none`, no hover affordance
- **Removed** `.queue-btn-accepted` and `.queue-btn-accepted:hover` CSS rulesets (dead code — button replaced by pill)
- **Removed** `queueUnaccept()` async function (dead code — no longer called from UI)

### `dashboard/server.js`
- **Removed** `/api/queue/{id}/unaccept` POST endpoint (no client callers remain)

### `test/dashboard-render.test.js` (new file)
- 1 STAGED + 2 QUEUED rows → asserts 1 `queue-btn-accept`, 2 `queue-accepted-pill`
- Edit button visible for all 3 rows
- Pill is a `<span>`, not a `<button>`
- 12 history rows → page sizes 5/5/2, totalPages=3
- Pagination controls: Prev disabled p1, Next disabled last page, labels correct
- `HISTORY_PAGE_SIZE === 5`

## Tests

All tests pass (all 19 test files, run via `node test/*.test.js`).

## Notes

- No `bridge/` files modified.
- Diff under 250 LOC (excluding tests).
