---
id: "045"
title: "Fix: staged panel typography and visual design"
status: DONE
from: obrien
to: kira
branch: slice/42-stakeholder-review-gate
commit: f15d5e5
created: "2026-04-10T01:15:00Z"
references: "042"
---

## Summary

Redesigned staged panel typography and visual styling in `dashboard/lcars-dashboard.html`. All changes scoped exclusively to `.staged-*` selectors — no other dashboard sections touched.

## Changes

### Font
- Switched entire staged panel to `system-ui, -apple-system, sans-serif` — no custom fonts
- Card title: `18px`, `font-weight: 600`
- Summary: `15px`, `font-weight: 400`, `line-height: 1.6`
- Amendment note: `14px`, italic, muted color (`#b0956a`)
- Section header: `13px`, `font-weight: 600`, `letter-spacing: 0.08em`, uppercase, muted

### Spacing
- Card padding: `20px 24px`
- Title → summary gap: `8px`
- Summary → buttons gap: `16px`
- Card → card gap: `16px`

### Buttons
- Height: `36px`, `border-radius: 6px`, `font-size: 14px`, `font-weight: 500`
- Commission: solid `#2563eb` blue, white text
- Amend: outlined, neutral border
- Reject: outlined, `#dc2626` red border and text
- Cancel: outlined, neutral
- Confirm Reject: solid `#dc2626`, white text
- Removed uppercase/letter-spacing from all buttons

### Details toggle
- `14px`, muted `#888`, `▸ Details` / `▾ Details`
- Toggle now updates arrow symbol on open/close
- Expanded body: `13px`, `system-ui`, `line-height: 1.5`, dark background (`#141414`), `border-radius: 4px`, `padding: 12px`

### Inline form inputs
- Matched button height (`36px`), `border-radius: 6px`, `font-size: 14px`
- Focus border color matches commission blue (`#2563eb`)

### Section header
- Shortened to "Awaiting Your Review"

## Success criteria

- [x] Staged panel uses system font stack
- [x] Title, summary, and buttons have clear visual hierarchy
- [x] Card spacing guides the eye without feeling cramped or loose
- [x] Buttons are clearly distinguishable by color/style
- [x] Details section is readable when expanded
- [x] No change to any other part of the dashboard
