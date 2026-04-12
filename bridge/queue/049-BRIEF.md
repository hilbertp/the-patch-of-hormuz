---
id: "049"
title: "Dashboard: title, pipeline stages, queue panel"
summary: "Three dashboard fixes: rename the title to The Rubicon, simplify the pipeline to 5 meaningful stages, and add a live queue panel alongside the history."
goal: "Dashboard header says The Rubicon, pipeline shows Commissioned → Development → Peer Review → QA → Merged, and pending/in-progress commissions are visible in a queue panel."
from: kira
to: obrien
priority: high
created: "2026-04-10T02:00:00Z"
references: "048"
timeout_min: null
status: PENDING
---

## Change 1 — Title

In `dashboard/lcars-dashboard.html`, change the header/page title from "Liberation of Bajor" (or "LCARS — Liberation of Bajor") to **"The Rubicon"**.

- Browser tab (`<title>`): `The Rubicon`
- Dashboard header text: `The Rubicon`

## Change 2 — Pipeline stages

The active commission pipeline visualization currently shows too many stages (VISUALIZING, COMMISSIONED, PENDING, IN PROGRESS, AWAITING REVIEW, IN REVIEW, ACCEPTED, CODE REVIEW, MERGING, MERGED). Replace with exactly 5:

```
Commissioned → Development → Peer Review → QA → Merged
```

Mapping from internal queue states:
- **Commissioned** = PENDING, IN_PROGRESS
- **Development** = IN_PROGRESS (active O'Brien work)
- **Peer Review** = EVALUATING, AWAITING REVIEW, IN REVIEW
- **QA** = ACCEPTED (post-acceptance check before merge)
- **Merged** = MERGED, DONE (for merge commissions)

For the live active commission: highlight the current stage. For the pipeline visualization showing the cycle (not live), just show the 5 stage labels as a static flow — no highlighting, no noise. Keep live detail (timer, current stage highlight) only for the active commission card, not for the general cycle diagram.

## Change 3 — Queue panel

Add a **Queue** panel showing live pending and in-progress commissions. Place it to the left of (or above) the Commission History panel.

Data source: `GET /api/bridge/queue` (already exists — returns queue file list).

Display:
- Section label: `Queue`
- Each item: commission ID, title, status badge (PENDING or IN PROGRESS)
- If empty: `Queue is clear.`
- Poll every 5 seconds (same as rest of dashboard)

Commission History remains as-is — rename its label to `History` for clarity.

Layout: two-column row — `Queue` left, `History` right. On narrow screens, stack vertically.

## Constraints

- No other visual changes — preserve the 048 redesign exactly.
- The Rubicon staged panel (047) unchanged.
- All existing JS functionality preserved.

## Success Criteria

- [ ] Browser tab and header both read "The Rubicon"
- [ ] Pipeline shows exactly 5 stages: Commissioned → Development → Peer Review → QA → Merged
- [ ] No VISUALIZING, AWAITING REVIEW, IN REVIEW, CODE REVIEW, MERGING stages anywhere
- [ ] Queue panel shows live PENDING and IN PROGRESS commissions
- [ ] Queue and History sit side by side
- [ ] Empty queue shows "Queue is clear."
