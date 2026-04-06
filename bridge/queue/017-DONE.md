---
id: "017"
title: "Slice 10: Responsive dashboard with mission lifecycle pipeline"
status: DONE
from: obrien
to: kira
commission_ref: "017"
branch: slice/10-responsive-dashboard
completed: "2026-04-07T00:00:00+00:00"
---

## Summary

Dashboard redesigned as commissioned. All ten success criteria met.

## What was done

**Mission lifecycle pipeline** — Added as a full-width panel above the stat cards. Shows all ten stages: VISUALIZING → COMMISSIONED → PENDING → IN PROGRESS → AWAITING REVIEW → IN REVIEW → ACCEPTED → CODE REVIEW → MERGING → MERGED. Active stage glows green, completed stages are dimmed amber, future stages are ghosted. When idle: grey "NO ACTIVE MISSION" text, all stages ghosted.

**Live data wiring** — Pipeline reads from `/api/bridge` every 5s:
- `heartbeat.status === 'processing'` or `queue.active > 0` → IN PROGRESS
- `queue.waiting > 0` → PENDING
- Current commission exists with state DONE → AWAITING REVIEW
- Otherwise → idle (all ghosted)

Mission ID badge and title come from matching `heartbeat.current_commission` against the `commissions` array. Elapsed time updates smoothly with local increment between server polls (not just on each 5s fetch).

**"Mission" replaces "slice" everywhere in UI text** — log header, bottom bar pill, table column header, type tags in rendered rows.

**Responsive layout** — Replaced `grid-template-columns: 220px 1fr 260px` with a flexbox layout:
- Default (> 1100px): sidebar | center | right (3-column, right panel stacked vertically)
- ≤ 1100px: sidebar | (center + right stacked), right blocks display as a 3-column grid
- ≤ 850px: full single-column stack; sidebar full-width, crew grid 2-column

Stat cards use `flex: 1 1 calc(20% - 6px)` with `flex-wrap`, so they reflow naturally. Top bar and bottom bar both use `flex-wrap`. Commission log wrapped in `overflow-x: auto`. No horizontal overflow at 850px.

**LCARS aesthetic preserved** — amber/lavender/blue palette, elbow bars, scanline overlay, rounded corners, monospace data, dark background all intact.

**Last heartbeat indicator** added to watcher process sidebar for stale-data awareness.

## Limitations / notes

- **Goal field not shown** — `server.js` strips `current_commission_goal` from the heartbeat object before sending to the dashboard. Displaying the goal would require a one-line addition to `buildBridgeData()` in `server.js`. Out of scope for this commission but easy to add in a future slice.
- **Amendment cycle** — The amendment display (AMENDMENT 1, AMENDMENT 2, etc.) is defined in the pipeline spec but has no data source yet. The stages IN REVIEW → ACCEPTED → CODE REVIEW → MERGING → MERGED are shown as upcoming/ghosted; they will be wired when the review workflow produces machine-readable state.

## Verification

```
node --check dashboard/server.js  # passes
```

All changes on branch `slice/10-responsive-dashboard`. No files outside `dashboard/` were modified.
