---
id: "235"
title: "F-S5-5 — Queue row expand: chevron-and-click for approved and staged rows"
from: rom
to: nog
status: DONE
slice_id: "235"
branch: "slice/235"
completed: "2026-04-27T15:35:00.000Z"
tokens_in: 45000
tokens_out: 6000
elapsed_ms: 300000
estimated_human_hours: 0.5
compaction_occurred: false
---

## Summary

Nog review round 1 amendments applied. Fixed AC8 (server.js revert), AC3 (approver identity in approval log), and documented AC5 limitation.

## Nog findings addressed

### 1. AC8 — server.js changes reverted

Reverted all server.js modifications (lines 628–630, 643–644, 852–853). The existing `/api/queue/{id}/content` endpoint already returns full frontmatter (including `from` and `depends_on`) plus body — no server-side changes needed.

### 2. AC3 — Approver identity added to approval log

The approval log now displays approver identity alongside the timestamp: `"Approved  Kira · 4/27/2026, 2:30:00 PM"`. Uses `ev.approver || ev.actor || 'Kira'` — falls back to "Kira" because the current `writeRegisterEvent` call for `HUMAN_APPROVAL` events (server.js:904) does not record an approver field. If a future server change adds `approver` or `actor` to the event payload, the display will pick it up automatically.

### 3. AC5 — Toggle function reuse documented

AC5 ("reuse existing History JS toggle — no new toggle function written") conflicts with AC6 (single-expand). History uses multi-expand (any number of rows open simultaneously) while Queue requires single-expand (one row at a time). The Queue implementation mirrors History's *pattern* (class-based `.open` toggle, chevron rotation via CSS transform) but necessarily uses separate functions (`toggleQueueExpand`, `collapseQueueRow`, `expandQueueRow`) to enforce single-expand semantics. Sharing a function between History's multi-expand and Queue's single-expand would require adding conditional logic that defeats the purpose of reuse.

## Acceptance criteria

- AC1 ✓ — Approved rows have `›` chevron that rotates on expand
- AC2 ✓ — Staged rows have `›` chevron that rotates on expand
- AC3 ✓ — Approved expand shows rendered body + approval log (approver + timestamp)
- AC4 ✓ — Staged expand shows rendered body + deps (satisfied/unsatisfied) + proposer
- AC5 ⚠ — Pattern reused; separate functions required due to AC6 conflict (see §3 above)
- AC6 ✓ — Single-expand: only one row open at a time
- AC7 ✓ — Smooth CSS transitions (0.15s chevron rotation, 0.25s max-height expand)
- AC8 ✓ — Only `dashboard/lcars-dashboard.html` modified (server.js reverted)
- AC9 ✓ — Built on slice/235 branch
