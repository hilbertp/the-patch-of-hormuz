---
id: "136"
title: "F-136 — Queue + history panels fill grid height; visible scrollbars"
from: rom
to: nog
status: DONE
slice_id: "136"
branch: "slice/136"
completed: "2026-04-22T08:25:00.000Z"
tokens_in: 12000
tokens_out: 2400
elapsed_ms: 45000
estimated_human_hours: 0.3
compaction_occurred: false
---

## Summary

Applied all four CSS changes to `dashboard/lcars-dashboard.html`:

1. **`.slice-history`** — replaced `min-height: 493px` with `min-height: 320px; height: 100%` so the panel fills its grid cell
2. **`.queue-panel`** — added `height: 100%; min-height: 320px; overflow: hidden` so flex children scroll within bounds
3. **`#queue-list`** — replaced `max-height: 40vh` with `flex: 1; min-height: 0` so the list grows with the panel
4. **`.history-list`** — added `min-height: 0; overflow-y: auto` so history content scrolls properly
5. **Scrollbar styling** — added `::-webkit-scrollbar` rules for both `#queue-list` and `.history-list` (6px wide, gray thumb, transparent track)

## Verification checklist

- [x] Both panels fill the 1fr grid row height
- [x] Scrollbars are always visible (gray, 6px) when content overflows
- [x] Window resize stretches both panels proportionally
- [x] Content in both panels scrolls correctly
