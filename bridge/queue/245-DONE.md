---
id: "245"
title: "F-S5-4b — Queue approve animation: slide+fade staged row into queue group"
from: rom
to: nog
status: DONE
slice_id: "245"
branch: "slice/245"
completed: "2026-04-28T07:42:30.000Z"
tokens_in: 28000
tokens_out: 4500
elapsed_ms: 120000
estimated_human_hours: 0.75
compaction_occurred: false
---

## Summary

Implemented queue approve and reject animations per Ziyal spec in `dashboard/lcars-dashboard.html`.

## What was done

### Commit 1 — Skeleton
- Added `.row-exiting` CSS class (opacity 0, translateY(-8px), 250ms ease transition)
- Added `.row-entering` CSS class with `rowEnter` keyframe animation (fade-in from below with highlight, 250ms ease)
- Added `.row-removing` CSS class (opacity 0, max-height collapse, 200ms ease)
- Declared `_pendingEnterIds = new Set()` module-level variable

### Commit 2 — Implementation
- **queueAccept()**: Adds `.row-exiting` to the staged row, waits 260ms for animation to complete, then fires POST. On success, adds ID to `_pendingEnterIds` so the re-rendered row in the approved group gets `.row-entering` class. Class auto-removed after 300ms.
- **queueReject()**: After confirm, starts `.row-removing` animation on the wrap element and fires POST simultaneously (Promise.all). Re-renders after both complete.
- **renderQueueRow()**: Checks `_pendingEnterIds` — if the row ID is pending, adds `row-entering` class to the queue-row element and schedules cleanup.

## Acceptance criteria

- **AC1** ✓ Two commits (skeleton + implementation)
- **AC2** ✓ Approve plays exit animation before POST fires
- **AC3** ✓ Newly approved row appears with fade-in-from-below entry animation
- **AC4** ✓ Reject plays opacity + max-height collapse animation
- **AC5** ✓ Rapid approves work independently — `_pendingEnterIds` is a Set, each row animates via its own DOM element
- **AC6** ✓ No animation on initial load — `_pendingEnterIds` starts empty, classes only added by user action
- **AC7** ✓ All changes in `dashboard/lcars-dashboard.html` only
