---
id: "045"
title: "Fix: staged panel typography and visual design"
summary: "The staged panel's font and spacing are hard to read. Redesign it with clean, simple typography optimized for scannability — no LCARS, just clarity."
goal: "The staged panel is easy to read at a glance. Clear hierarchy, good spacing, legible font."
from: kira
to: obrien
priority: normal
created: "2026-04-10T01:00:00Z"
references: "042"
timeout_min: null
status: "PENDING"
---

## Problem

The staged panel uses poor typography — wrong font size, wrong type choices, spacing that doesn't guide the eye. It's hard to scan quickly.

## Design direction

Simple. Clean. Maximum readability. No LCARS. Think: a developer reading a pull request list, not a starship console.

## Specific changes to `dashboard/lcars-dashboard.html` — staged panel only

**Font**
- Use `system-ui, -apple-system, sans-serif` — whatever the OS renders natively. No custom fonts.
- Card title (`#042 · Stakeholder review gate`): `18px`, `font-weight: 600`
- Summary text: `15px`, `font-weight: 400`, `line-height: 1.6`
- Amendment note (if shown): `14px`, italic, muted color

**Spacing**
- Card padding: `20px 24px`
- Gap between title and summary: `8px`
- Gap between summary and buttons: `16px`
- Gap between cards: `16px`

**Buttons**
- Height: `36px`, `border-radius: 6px`, `font-size: 14px`, `font-weight: 500`
- Commission: solid, primary color (e.g. `#2563eb` blue)
- Amend: outlined, neutral
- Reject: outlined, muted red (`#dc2626`)
- Gap between buttons: `8px`

**Section header**
- "Awaiting Your Review" — `13px`, `font-weight: 600`, `letter-spacing: 0.08em`, `text-transform: uppercase`, muted color. Acts as a label, not a headline.

**Details toggle**
- `14px`, muted color, `▸ Details` / `▾ Details`
- Expanded body: `13px`, monospace or `system-ui`, `line-height: 1.5`, light background (`#f8f9fa`), `border-radius: 4px`, `padding: 12px`

## Constraints

- Only change styles in the staged panel. Do not touch queue view, active commission panel, or system health pill.
- No new dependencies.
- Must look clean on both light backgrounds and the existing dark dashboard theme.

## Success Criteria

- [ ] Staged panel uses system font stack
- [ ] Title, summary, and buttons have clear visual hierarchy
- [ ] Card spacing guides the eye without feeling cramped or loose
- [ ] Buttons are clearly distinguishable by color/style
- [ ] Details section is readable when expanded
- [ ] No change to any other part of the dashboard
