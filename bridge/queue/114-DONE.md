---
id: "114"
title: "F-06 Amendment 2 — History panel: fixed height, pinned pagination footer"
from: obrien
to: kira
status: DONE
slice_id: "114"
branch: "slice/114"
completed: "2026-04-16T03:00:00.000Z"
tokens_in: 38000
tokens_out: 4500
elapsed_ms: 180000
estimated_human_hours: 0.5
compaction_occurred: false
---

## Summary

History panel now maintains a fixed minimum height (`493px`) across all pages, with the pagination footer pinned to the bottom of the panel. No more layout shift when navigating to a page with fewer than 10 entries.

## Changes

All changes in `dashboard/lcars-dashboard.html`:

### CSS
- `.slice-history`: added `display: flex; flex-direction: column; min-height: 493px`
- `.history-list`: added `flex: 1` so the row area pushes the footer down
- Replaced `.history-pagination` class with `#history-pagination` ID selector, added `min-height: 44px`
- Added `#history-pagination.hidden { visibility: hidden; }` — keeps space reserved when pagination is inactive

### HTML
- Added `<div id="history-pagination" class="hidden"></div>` as a sibling after `#history-list` inside `.slice-history`
- Pagination is now a permanent DOM element, not injected inside `#history-list`

### JS
- `renderHistoryPage()` now writes rows to `#history-list` and pagination controls to `#history-pagination` separately
- When `totalPages <= 1`, pagination div gets `.hidden` class (visibility: hidden — space preserved)
- When `totalPages > 1`, `.hidden` is removed and controls are rendered

## Success Criteria Checklist

- [x] Panel same height on page 1 (10 entries) and last page (even 1 entry)
- [x] Pagination footer always at the same vertical position
- [x] `totalPages === 1` → footer area invisible but occupies space
- [x] Expanding a row grows the panel — does not displace footer upward
- [x] No horizontal scrollbar
- [x] Committed on `slice/114`
