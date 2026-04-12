---
id: "051"
title: "Study: 5 ways to indicate ongoing work in active commission panel"
summary: "Build a standalone HTML comparison page showing 5 distinct visual treatments for the active commission card while a commission is in progress — beyond just a timer."
goal: "Philipp picks one treatment to implement. Output is a static study page, not a change to the live dashboard."
from: kira
to: obrien
priority: high
created: "2026-04-11T00:00:00Z"
references: "048"
timeout_min: null
status: "PENDING"
---

## Context

The active commission panel currently shows: title, stage label, pipeline bar, and a running timer (e.g. `00:16`). Philipp wants richer visual feedback that work is actually happening. This commission produces a **study page only** — no changes to the live dashboard.

## Deliverable

Create `dashboard/study-active-panel.html` — a single self-contained HTML file with all 5 variants rendered side by side (or stacked) for comparison. Each variant shows a realistic mock of the commission 050 card: title "Dashboard: full-width layout for MacBook", stage "Development", pipeline at the Development step, and a timer at 00:16.

## The 5 Variants

**Variant A — Animated progress bar**
A thin bar at the top of the card that pulses or animates slowly left-to-right (indeterminate, not percentage-based). Subtle, single color (e.g. a #6366f1 indigo line). No other changes to the card.

**Variant B — Pulsing status dot**
The header-level PROCESSING dot (already in the dashboard) also appears inside the card, left of the stage label ("● Development"). The dot pulses with a CSS keyframe animation (scale + opacity). Timer stays. No bar.

**Variant C — Skeleton shimmer on the stage label**
The stage label text ("Development") has a shimmer/glint animation passing over it — like a skeleton loader. Conveys "live / updating". Rest of card is static.

**Variant D — Step counter**
Replace or supplement the timer with a step indicator: `Step 2 of 5 — Development` plus the elapsed time below. No animation — purely informational, scannable at a glance.

**Variant E — Subtle card border animation**
The card border cycles through a slow animated glow or walking-dash animation (border-image or outline pulse). The card border color transitions gently between neutral gray and a soft blue/indigo. No internal changes.

## Instructions

- All animations must be CSS-only (no JS for the animations themselves).
- Include a label above each variant: "A — Animated progress bar", etc.
- Use the same font/color palette as the 048 dashboard (system-ui, #111827, #6b7280, #f9fafb background, #e5e7eb borders).
- The study page does NOT need to poll any server — all data is hardcoded mock data.

## Success Criteria

- [ ] `dashboard/study-active-panel.html` exists and opens in a browser without errors
- [ ] All 5 variants are visible and labeled
- [ ] Each variant's animation runs correctly in Safari and Chrome
- [ ] Visual style matches the 048 dashboard palette
- [ ] No changes made to `dashboard/lcars-dashboard.html`
