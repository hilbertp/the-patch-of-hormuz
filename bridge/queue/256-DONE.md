---
id: "256"
title: "F-UI — Hide sprint badge column from queue rows"
from: rom
to: nog
status: DONE
slice_id: "256"
branch: "slice/256"
completed: "2026-04-28T09:03:00.000Z"
tokens_in: 12000
tokens_out: 2500
elapsed_ms: 45000
estimated_human_hours: 0.1
compaction_occurred: false
---

## Summary

Hid the `.sprint-badge` element from all queue rows via a CSS-only change in `dashboard/lcars-dashboard.html`.

## Commits

1. `51d6dd1` — chore: add UX-request comment to sprint-badge CSS block
2. `af8da1e` — fix: hide sprint badge from queue rows via display:none

## Acceptance criteria

- **AC1. Two commits minimum** — Done (2 commits).
- **AC2. No sprint badge visible on any queue row** — Done. `display: none` hides all `.sprint-badge` elements.
- **AC3. Queue rows look clean without the badge gap** — Done. Removing the element from flow eliminates spacing.
- **AC4. Changes only in `dashboard/lcars-dashboard.html`** — Done. No other files touched.

## Notes

- The JS that computes `sprintLabel` and renders `<span class="sprint-badge">` is untouched, preserving data for potential future use.
