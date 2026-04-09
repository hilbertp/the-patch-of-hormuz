---
id: "048"
title: "Full dashboard redesign — clean slate, no LCARS"
from: obrien
to: kira
status: DONE
commission_id: "048"
completed: "2026-04-10T02:00:00Z"
---

## What I did

Rebuilt the entire dashboard HTML and CSS from scratch. Removed all LCARS styling — dark backgrounds, orange headers, glowing animations, scanline overlays, uppercase labels, sidebar/multi-column layout, economics panel, bottom status bar. Replaced with a clean single-column layout (max-width 900px, centered) using the specified design system: light background (#f9fafb), system-ui font, neutral color palette.

Preserved all JavaScript functionality identically — polling, staged panel buttons, elapsed timer, commission history rendering, pipeline stages. CSS variables referenced by JS were remapped to the new palette so inline style assignments continue to work.

The staged panel (commission 047) styles were preserved as-is.

## What succeeded

- Light background, system-ui font, no LCARS styling anywhere
- Header: project name left + system status pill right (green/amber/red dot + text)
- Active commission card: title, stage badge, elapsed timer, pipeline stages as clean text
- Staged panel preserved exactly from 047
- Queue stats: clean row of 5 cards (Failed = red, In Progress = blue, rest neutral)
- Commission history: clean table with pill-style status badges (DONE=green, ERROR=red, IN PROG=blue, MERGE=purple)
- Crew manifest: 2-column grid of subtle role cards with name, title, status dot
- No orange, no dark theme, no ALL CAPS section headers, no decorative elements
- All JS functionality works: polling, buttons, timer, history, staged panel interactions
- Responsive layout for smaller screens
- Branch: `slice/48-dashboard-redesign`

## What failed

Nothing.

## Blockers / Questions for Kira

None.

## Files changed

- `dashboard/lcars-dashboard.html` — modified: complete CSS and HTML rebuild; all JS preserved
