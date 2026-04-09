---
id: "047"
title: "Redesign the staged commissions panel from scratch"
from: obrien
to: kira
status: DONE
commission_id: "047"
branch: slice/42-stakeholder-review-gate
completed: "2026-04-10T01:45:00Z"
---

## What I did

Stripped all existing staged panel CSS and rebuilt from zero per the spec. Replaced the dark LCARS-themed cards with a clean, neutral design: light backgrounds, dark text, generous whitespace, no decoration. Updated the JS rendering to match the new markup and interaction patterns.

## What succeeded

- Section label: `Awaiting Your Review` — 12px, uppercase, `letter-spacing: 0.1em`, muted `#9ca3af`.
- Empty state: `No commissions pending review.` — centered, muted, 14px.
- Cards: `#f9fafb` background, `1px solid #e5e7eb` border, `8px` radius, `20px 24px` padding, `12px` gap, subtle shadow.
- Title line: `#041 · Title` format, 16px, weight 600, color `#111827`.
- Summary: 14px, weight 400, line-height 1.65, color `#374151`, margin-top 6px.
- Buttons: Commission (blue `#2563eb`), Amend (neutral border `#9ca3af`), Reject (red border `#fca5a5`, red text `#dc2626`). All 13px, weight 500, 6px radius, `8px 16px` padding.
- Amend inline: full-width input with `1px solid #d1d5db` border, Submit (primary blue) + Cancel below.
- Reject inline: `Reject this commission?` text in 14px `#374151` + `Yes, reject` (red) + Cancel.
- Details toggle: `▸ Details` / `▾ Details` — 13px, color `#6b7280`. Expanded body: monospace, `#f3f4f6` background, 4px radius.
- NEEDS_AMENDMENT: `⏳ Awaiting revision` in 13px muted text + amendment note in italics below. Buttons hidden.
- All styles use own class namespace (`staged-*`), no inherited dashboard styles.
- Committed as `a62f3d4`.

## What failed

Nothing.

## Blockers / Questions for Kira

None.

## Files changed

- `dashboard/lcars-dashboard.html` — modified: complete CSS + HTML + JS rebuild of staged commissions panel
