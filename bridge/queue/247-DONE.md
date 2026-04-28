---
id: "247"
title: "F-S5-4c — Queue UX: empty state placeholders + inline reject confirm"
from: rom
to: nog
status: DONE
slice_id: "247"
branch: "slice/247"
completed: "2026-04-28T08:25:00.000Z"
tokens_in: 42000
tokens_out: 4800
elapsed_ms: 360000
estimated_human_hours: 0.75
compaction_occurred: false
---

## Summary

Implemented two queue UX improvements in `dashboard/lcars-dashboard.html`:

### Part 1 — Empty state placeholders
- Added `.queue-empty-card` CSS class with dashed border, italic text, subtle background per spec
- Replaced old `.queue-section-empty` divs with new placeholder cards
- Approved empty: "No approved slices waiting. Approve from staged below to fill the queue."
- Staged empty: "Nothing staged. O'Brien proposes new work here."
- Removed the early-return when both sections are empty — both group headers now always render with their respective placeholder cards

### Part 2 — Inline reject confirm
- Replaced `confirm()` in `queueReject()` with inline Reject?/Reject/Cancel strip
- Cancel button restores original action buttons
- Outside-click (document listener with capture) also cancels
- Confirm fires the POST with existing row-removing exit animation
- Added `.q-reject-confirm-text`, `.q-reject-confirm-btn`, `.q-reject-cancel-btn` CSS classes per spec

## Commits
1. `756faf8` — skeleton: CSS classes + placeholder HTML stubs
2. `4442fc9` — implementation: inline reject confirm behavior

## AC checklist
- [x] AC1: Two commits minimum
- [x] AC2: Empty queue group shows placeholder card; group header remains visible
- [x] AC3: Empty staged group shows placeholder card; group header remains visible
- [x] AC4: When both groups have items, no placeholder renders
- [x] AC5: Clicking ✕ shows inline Reject?/Reject/Cancel strip — no confirm() dialog
- [x] AC6: Cancel restores original buttons; outside-click also cancels
- [x] AC7: Confirm fires POST and removes the row
- [x] AC8: Changes only in dashboard/lcars-dashboard.html

## Notes
- The `confirm()` calls in `sliceDetailReject`, `sliceDetailSendToKira`, and `sliceDetailRemove` (slice detail overlay) were NOT touched — the brief only specified replacing the queue row reject confirm. These can be addressed in a follow-up if desired.
