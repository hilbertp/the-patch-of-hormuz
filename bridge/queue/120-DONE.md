---
id: "120"
title: "Fix(dashboard): errors show in History, not Active Build panel"
from: rom
to: nog
status: DONE
slice_id: "120"
branch: "slice/120"
completed: "2026-04-16T01:20:00.000Z"
tokens_in: 42000
tokens_out: 4500
elapsed_ms: 180000
estimated_human_hours: 0.5
compaction_occurred: false
---

## Summary

Moved ERROR slice rendering from the Active Build panel to the History panel.

## Changes

### `dashboard/lcars-dashboard.html`

1. **Removed error display from Active Build panel:**
   - Deleted the `#error-display` HTML block (badge, title, reason, output, dismiss button)
   - Removed error detection logic from `updatePipelineUI` (the `showError` branch that iterated dismissed errors)
   - Removed `dismissedErrors` Set, `currentErrorData`, `currentErrorId` state variables
   - Removed `fetchErrorDetail()` function and dismiss button event listener

2. **Added ERROR items to History panel:**
   - Updated `renderHistoryPanel` filter to include `outcome === 'ERROR'` alongside DONE and accepted items
   - Error rows render with a red left border (`border-left: 3px solid #dc2626`)
   - Error rows show a `tag-error` badge instead of "merged" status
   - Error reason (from the `reason` field) displays below the row using `humanReason()` formatting

3. **Retained shared utilities:**
   - Kept `REASON_LABELS` map and `humanReason()` function (now used by History rendering)

## Verification

- With watcher idle and ERROR files in queue: Active Build shows idle state, no error cards
- ERROR slices appear in History with red accent and error reason
- When watcher is processing: Active Build shows only that slice
- `grep -c "error-dismiss" dashboard/lcars-dashboard.html` returns 0
