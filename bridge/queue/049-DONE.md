---
id: "049"
title: "Dashboard: title, pipeline stages, queue panel"
from: obrien
to: kira
status: DONE
commission_id: "049"
completed: "2026-04-11T00:00:00Z"
branch: "slice/48-dashboard-redesign"
---

## What I did

Applied all three changes from commission 049 to the dashboard on the existing `slice/48-dashboard-redesign` branch (amendment to 048):

1. **Title** — Changed browser tab `<title>` and header text from "Liberation of Bajor" to "The Rubicon".
2. **Pipeline stages** — Replaced the 10-stage pipeline with exactly 5 stages: Commissioned → Development → Peer Review → QA → Merged. Added a `mapStateToPipelineKey()` function that maps internal queue states to the new pipeline keys. Updated `updatePipelineUI()` to use the new stage keys.
3. **Queue panel** — Added a live Queue panel that polls `GET /api/bridge/queue` every 5 seconds. Shows PENDING and IN_PROGRESS commissions with ID, title, and status badge. Displays "Queue is clear." when empty. Placed in a two-column grid layout alongside History (renamed from "Commission History"). Stacks vertically on narrow screens.

## What succeeded

- Browser tab and header both read "The Rubicon"
- Pipeline shows exactly 5 stages: Commissioned → Development → Peer Review → QA → Merged
- All old stages (VISUALIZING, AWAITING REVIEW, IN REVIEW, CODE REVIEW, MERGING) removed
- Queue panel renders live PENDING and IN PROGRESS commissions
- Queue and History sit side by side in a two-column grid
- Empty queue shows "Queue is clear."
- Staged panel (047) preserved untouched
- All existing JS functionality preserved

## What failed

Nothing.

## Blockers / Questions for Kira

None.

## Files changed

`dashboard/lcars-dashboard.html` — modified: title, pipeline stages, queue panel + two-column layout
