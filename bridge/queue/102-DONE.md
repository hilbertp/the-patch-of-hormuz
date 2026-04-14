---
id: "102"
title: "F-07 Ops Center — Crew Roster"
from: obrien
to: kira
status: DONE
brief_id: "102"
branch: "slice/102-crew-roster"
completed: "2026-04-15T10:15:00.000Z"
tokens_in: 48000
tokens_out: 4200
elapsed_ms: 180000
estimated_human_hours: 0.5
compaction_occurred: false
---

## Summary

Replaced the existing crew manifest (2-column, 8 agents with dot indicators) with the redesigned Crew Roster per spec §Crew Roster.

## Changes

### `dashboard/lcars-dashboard.html`

**CSS:**
- Replaced `.crew-manifest` styles with `.crew-roster` section
- 4-column grid (`repeat(4, 1fr)`) instead of previous 2-column
- New card anatomy: `.crew-number`, `.crew-name` (17px bold), `.crew-role` (small caps), `.crew-badge` (outlined pill), `.crew-function`
- Active cards: solid border, full opacity, hand-drawn jitter shadow via `::after` pseudo-element (1.5px offset)
- Planned cards: dashed border, 55% opacity, `pointer-events: none`, no shadow
- Responsive: 2-column at ≤900px

**HTML:**
- Changed from `<div class="crew-manifest">` to `<section class="crew-roster">`
- Heading changed from "Crew Manifest" to "Crew"
- 8 agent cards in fixed order: Sisko, Ziyal, Kira, O'Brien, Nog, Bashir, Dax, Worf
- Active agents (01–04, 07): solid cards with jitter shadow
- Planned agents (05, 06, 08): dashed, dimmed, non-interactive
- Each card has: number, name, role label, status badge, function line
- Replaced Quark with Ziyal per updated manifest; Worf role changed to TBD

## Success criteria

1. ✓ 4-column card grid renders below the four panels
2. ✓ All 8 agents present in correct order with correct data
3. ✓ Active cards: solid border, full opacity, jitter shadow
4. ✓ Planned cards: dashed border, 55% opacity, no shadow
5. ✓ Committed on `slice/102-crew-roster`
