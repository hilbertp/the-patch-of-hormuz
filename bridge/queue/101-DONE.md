---
id: "101"
title: "F-06 Ops Center — History panel redesign"
from: obrien
to: kira
status: DONE
brief_id: "101"
branch: "slice/101-history-panel"
completed: "2026-04-15T09:15:00.000Z"
tokens_in: 95000
tokens_out: 12000
elapsed_ms: 420000
estimated_human_hours: 2.0
compaction_occurred: false
---

## Summary

Redesigned the History panel from a flat table layout to the spec'd row-based format with sprint badges, two-step chevron expand, and a full History Briefing Detail overlay.

## Changes

### History Panel (`dashboard/lcars-dashboard.html`)

**Row format redesign:**
- Replaced `<table>` layout with div-based `.history-row` components
- Each row: `▸ #id · Sprint n · Title · [merged]`
- Sprint badge derived from slice ID range (same `.sprint-badge` style as Queue panel)
- `[merged]` status badge right-aligned, green

**Two-step expand:**
- `▸` chevron as first element of each row
- Click rotates to `▾` and reveals second line: italic description + `Details ›` button
- One row expanded at a time — opening a new row collapses the previous
- Description: first sentence from slice goal/objective

**History Briefing Detail overlay (Screen ⑤):**
- Full-viewport overlay (z-index 950, above slice detail at 900)
- Header: slice ID, title, context bar
- Context bar: Sprint · Builder · Outcome · Duration · Tokens · Cost
- Duration + tokens pulled from register.jsonl DONE events; `—` for missing values
- Body: fetches full brief content via `/api/queue/{id}/content` and renders with `renderRenderedTab()` (shared with Slice Detail); fallback to register data if API unavailable
- Footer: `✕ Close` button right-aligned
- Dismissed by close button, Escape key, or backdrop click

**Filtering:**
- Only merged/DONE items shown (errors and in-progress filtered out)
- Newest first (matches existing sort from `/api/bridge`)

### Sprint derivation

Added `getSprintForId()` function: Sprint 1 = IDs 1–50, Sprint 2 = 51–100, Sprint 3 = 101+. This is a simple range-based approach that can be replaced with frontmatter-based logic when sprint metadata is available in the register.

## Amendment note

This brief references 096. Branch `slice/096-layout-restructure` is an ancestor of the current lineage (096 → 098 → 099 → 100). Created `slice/101-history-panel` from current HEAD to preserve all prior work while isolating this delivery.

## Success Criteria

1. ✓ History rows show `#id · Sprint n · Title · [merged]` format
2. ✓ Sprint badge on every row
3. ✓ Chevron click expands the row with description + `Details ›`
4. ✓ Opening a new row collapses the previously open one
5. ✓ `Details ›` opens full briefing overlay
6. ✓ Context bar shows duration, tokens, cost with `—` for missing values
7. ✓ Overlay dismissed by close button and Escape
8. ✓ Committed on `slice/101-history-panel`
