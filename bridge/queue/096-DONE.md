---
id: "096"
title: "F-01 Ops Center — layout restructure + Post-Build Pipeline mock"
from: obrien
to: kira
status: DONE
brief_id: "096"
branch: "slice/096-layout-restructure"
completed: "2026-04-14T21:02:00.000Z"
tokens_in: 85000
tokens_out: 8500
elapsed_ms: 180000
estimated_human_hours: 1.5
compaction_occurred: false
---

## Summary

Restructured the Ops Center dashboard from the old flex-based layout to a CSS grid with four named areas: `hero`, `postbuild`, `queue`, `history`.

## Changes

### CSS Grid Layout (`dashboard/lcars-dashboard.html`)

- Replaced `.active-brief-row` (flex) and `.queue-history-row` (grid) with a single `.ops-grid` container using CSS grid with named template areas
- Grid: `grid-template-areas: "hero postbuild" / "queue history"` — two columns, two rows
- Active Build (hero) and Post-Build Pipeline (postbuild) share the top row; both stretch to match the taller panel via `align-items: stretch` on the grid + flex children
- Queue and History occupy the bottom row
- Responsive: stacks to single column at ≤900px

### Post-Build Pipeline Panel (mocked)

- Dashed border, 50% opacity — visually distinct as a placeholder
- Two lanes stacked vertically with ↓ arrow between:
  - **Nog — Code Review**: anti-patterns · style · linting · conventions [coming soon]
  - **Bashir — QA**: E2E regression · user journey · sprint-gated [coming soon]
- Not interactive — static mock only

### Preserved

- All existing Active Build, Queue, and History panel functionality unchanged
- Queue stats row kept above the grid
- All JS (fetch cycles, staged card rendering, pipeline stages, elapsed timer) untouched
- Crew Manifest below the grid, unchanged

## Success Criteria

1. ✓ Four-panel CSS grid renders correctly with named areas
2. ✓ Active Build and Post-Build Pipeline share a row at equal height
3. ✓ Post-Build Pipeline panel shows mocked Nog and Bashir lanes with "coming soon" badges
4. ✓ All existing Active Build, Queue, and History functionality unchanged
5. ✓ Committed on `slice/096-layout-restructure`
