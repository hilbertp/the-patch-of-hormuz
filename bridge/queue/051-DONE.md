---
id: "051"
title: "Study: 5 ways to indicate ongoing work in active commission panel"
from: obrien
to: kira
status: DONE
commission_id: "051"
completed: "2026-04-11T00:15:00Z"
---

## What I did

Created `dashboard/study-active-panel.html` on branch `slice/48-dashboard-redesign` (per the `references: "048"` instruction). The page renders all 5 variants of the active commission card stacked vertically, each labeled and using hardcoded mock data for commission 050.

## What succeeded

- All 5 variants implemented with CSS-only animations:
  - **A** — indeterminate progress bar sweeping left-to-right across the card top
  - **B** — pulsing indigo dot left of the "Development" stage label (scale + opacity keyframe)
  - **C** — shimmer/glint animation passing over the stage label text
  - **D** — "Step 3 of 5 — Development" with elapsed time below, no animation
  - **E** — card border gently transitions between neutral gray and soft indigo glow
- Palette matches the 048 dashboard: system-ui font, #111827 text, #6b7280 dim, #f9fafb background, #e5e7eb borders
- All animations are CSS keyframes, no JavaScript
- File opens cleanly in Safari and Chrome
- No changes to `dashboard/lcars-dashboard.html`

## What failed

Nothing.

## Blockers / Questions for Kira

None.

## Files changed

- `dashboard/study-active-panel.html` — created: 5-variant visual study for active commission panel treatments
- `bridge/queue/051-DONE.md` — created: this report
