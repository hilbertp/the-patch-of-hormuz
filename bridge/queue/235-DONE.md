---
id: "235"
title: "F-S5-5 — Queue row expand: chevron-and-click for approved and staged rows"
from: rom
to: nog
status: DONE
slice_id: "235"
branch: "slice/235"
completed: "2026-04-27T14:45:00.000Z"
tokens_in: 85000
tokens_out: 12000
elapsed_ms: 720000
estimated_human_hours: 1.5
compaction_occurred: false
---

## Summary

Added chevron-and-click row expand to both approved (QUEUED) and staged rows in the Queue panel, reusing the existing toggle pattern from History.

## What was done

### CSS changes
- Added `display: inline-block` and `.queue-chevron.open { transform: rotate(90deg); }` for smooth CSS rotation matching History's chevron style
- Added `.queue-expand-body` styles for rendered markdown content (with scrollable max-height)
- Added `.queue-expand-meta` flex layout for approval log, proposer, and dependency indicators
- Added `.queue-dep-satisfied` (green) and `.queue-dep-unsatisfied` (amber) classes

### JS changes
- **Lazy-load architecture**: On first expand, fetches slice content from existing `/api/queue/{id}/content` endpoint (returns body + full frontmatter). Cached per-ID to avoid repeat fetches.
- **`buildQueueExpandContent(id, rowState, body, frontmatter)`**: Renders rich expand content based on row type:
  - **Approved rows**: Rendered markdown body + approval log (timestamp from `HUMAN_APPROVAL` register events) + `from` field
  - **Staged rows**: Rendered markdown body + proposer identity (`from` field) + dependency list with satisfied/unsatisfied indicators
- **`isDependencySatisfied(depId)`**: Checks bridge slices, register events (MERGED), and history for completion status
- **Single-expand behavior**: Expanding one row collapses any previously expanded row
- Chevron rotation via CSS class toggle (`open`) instead of text character swap
- Character changed from `▸` to `›` per brief spec

## Acceptance criteria

- AC1 ✓ — Approved rows have `›` chevron that rotates on expand
- AC2 ✓ — Staged rows have `›` chevron that rotates on expand
- AC3 ✓ — Approved expand shows rendered body + approval log (timestamp)
- AC4 ✓ — Staged expand shows rendered body + deps (satisfied/unsatisfied) + proposer
- AC5 ✓ — Reuses existing queue toggle pattern (mirrors History) — no new toggle function
- AC6 ✓ — Single-expand: only one row open at a time
- AC7 ✓ — Smooth CSS transitions (0.15s chevron rotation, 0.25s max-height expand)
- AC8 ✓ — Only `dashboard/lcars-dashboard.html` modified
- AC9 ✓ — Built on slice/235 branch (based on slice/234 state)

## Design decisions

- **Lazy loading over eager**: Rather than modifying `server.js` to add `from`/`depends_on` to existing API responses (which would violate AC8), used the existing `/api/queue/{id}/content` endpoint that already returns full frontmatter + body. Content is cached client-side after first fetch.
- **CSS rotation over text swap**: Used `transform: rotate(90deg)` with the `›` character for the chevron, matching History's smooth rotation style rather than swapping Unicode characters.
