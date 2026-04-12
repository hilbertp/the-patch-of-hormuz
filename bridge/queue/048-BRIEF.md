---
id: "048"
title: "Full dashboard redesign — clean slate, no LCARS"
summary: "The entire dashboard gets rebuilt from scratch with clean, readable design. No orange headers, no dark sci-fi aesthetic, no LCARS anything. Developer tool, not a starship."
goal: "The dashboard at localhost:4747 is visually clean, easy to read, and guides the eye naturally. All existing functionality preserved."
from: kira
to: obrien
priority: high
created: "2026-04-10T01:30:00Z"
references: null
timeout_min: null
status: "PENDING"
---

## Objective

Throw away all visual styling in `dashboard/lcars-dashboard.html` and rebuild from scratch. Do not reference or carry forward any existing CSS. Treat it as a blank canvas.

The current dashboard has a dark LCARS sci-fi aesthetic (orange headers, dark backgrounds, glowing text, uppercase everywhere). This hurts readability and distracts from the content. Replace it entirely.

## Design principles

- **Readability first.** Every decision serves the human eye.
- **Clean and neutral.** Light background, dark text, color only where it carries meaning.
- **Clear hierarchy.** The eye should move naturally: status → active commission → queue → history.
- **Developer tool aesthetic.** Think Linear, Vercel, GitHub — not a starship console.
- **No decoration.** No textures, no glows, no borders for the sake of borders, no ALL CAPS labels everywhere.

## Global styles

- Background: `#f9fafb`
- Font: `system-ui, -apple-system, sans-serif`
- Base text: `#111827`, `14px`, `line-height: 1.6`
- Muted text: `#6b7280`
- Accent/primary: `#2563eb`
- Danger: `#dc2626`
- Success: `#16a34a`
- Border: `#e5e7eb`
- Card background: `#ffffff`, `border-radius: 8px`, `box-shadow: 0 1px 3px rgba(0,0,0,0.06)`

## Layout

Single column, max-width `900px`, centered, `padding: 32px 24px`.

Top to bottom:
1. **Header** — project name left, system status pill right. Simple, no color block.
2. **Active commission** — card showing current commission title, stage, elapsed time. If idle: "No active commission."
3. **Awaiting Your Review** — Rubicon staged panel (already redesigned in 047, preserve that work exactly).
4. **Queue stats** — one row: Waiting · In Progress · Complete · Failed · For Review. Numbers only, no color theatrics except Failed (red) and In Progress (blue).
5. **Commission history** — clean table: ID, description, status badge, duration. Status badges: small pill, colored background, e.g. DONE = green, ERROR = red, IN PROG = blue, MERGE = purple.
6. **Crew manifest** — role cards in a 2-column grid: name, title, status dot (green/amber/grey). Subtle, not the dominant element.

## Header

```
Liberation of Bajor                              ● ONLINE
```
- Left: `20px`, `font-weight: 700`, `color: #111827`
- Right: status pill — `12px`, `font-weight: 500`, green dot + "ONLINE" / red dot + "OFFLINE"
- Bottom border: `1px solid #e5e7eb`
- No STARDATE, no LOCAL time clock, no "LCARS STATION OPS"

## Active commission card

- Title: `16px`, `font-weight: 600`
- Stage badge: small pill (same style as history badges)
- Elapsed timer: `font-variant-numeric: tabular-nums`, right-aligned, `color: #6b7280`
- Stage pipeline: simple horizontal list of stage names, current stage highlighted in blue, others muted. No boxes, no arrows — just dots or underlines.

## Constraints

- All existing JavaScript functionality must be preserved exactly — only CSS and HTML structure changes.
- The Rubicon staged panel (commission 047 styling) must be preserved as-is.
- No external CSS frameworks or fonts.
- No LCARS, no orange, no dark background, no sci-fi aesthetic anywhere.

## Success Criteria

- [ ] Dashboard loads with light background, system-ui font, no LCARS styling
- [ ] Header shows project name + system status pill only
- [ ] Active commission card is readable at a glance
- [ ] Queue stats row is clean and scannable
- [ ] Commission history table is easy to read
- [ ] Crew manifest uses subtle role cards
- [ ] Rubicon staged panel unchanged from 047
- [ ] All existing JS functionality works (polling, buttons, timer, history)
- [ ] No orange, no dark theme, no ALL CAPS section headers
