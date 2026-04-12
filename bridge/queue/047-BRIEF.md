---
id: "047"
title: "Redesign the staged commissions panel from scratch"
summary: "The staged commissions panel needs a complete visual redesign. Build it clean from zero — clear hierarchy, good typography, nothing decorative."
goal: "The staged commissions panel is visually clean, easy to scan, and guides the eye naturally through title → summary → action."
from: kira
to: obrien
priority: high
created: "2026-04-10T01:20:00Z"
references: "042"
timeout_min: null
status: "PENDING"
---

## Objective

Throw away the current styling of the staged commissions panel in `dashboard/lcars-dashboard.html` and rebuild it from zero. Do not reuse any existing panel styles from the rest of the dashboard. Treat this as a blank canvas.

## Design principles

- **Readability first.** Every decision serves the human eye, not aesthetics.
- **Clear hierarchy.** ID + title → summary → buttons. The eye moves top to bottom without hunting.
- **Generous whitespace.** Breathing room between elements. Cards don't crowd each other.
- **Neutral palette.** White or very light grey background for cards. Dark text. Color only on buttons to signal action type.
- **No decoration.** No borders for the sake of borders. No background textures. No uppercase everywhere. No blinking. No glow.

## Specifics

**Page section**
- Section label: `Awaiting Your Review` — small, muted, `12px`, uppercase, `letter-spacing: 0.1em`. Acts as a quiet label, not a headline.
- Empty state: `No commissions pending review.` — centered, muted, `14px`.

**Card**
- Background: `#ffffff` or `#f9fafb`
- Border: `1px solid #e5e7eb`
- Border-radius: `8px`
- Padding: `20px 24px`
- Margin between cards: `12px`
- Subtle box-shadow: `0 1px 3px rgba(0,0,0,0.06)`

**Title line**
- Format: `#041 · Unmerged accepted branch alert`
- Font: `system-ui, -apple-system, sans-serif`
- Size: `16px`, `font-weight: 600`, color `#111827`

**Summary**
- `14px`, `font-weight: 400`, `line-height: 1.65`, color `#374151`
- Margin-top: `6px`

**Buttons** (margin-top: `16px`, gap: `8px`)
- Commission: `background #2563eb`, white text, `border-radius: 6px`, `padding: 8px 16px`, `font-size: 13px`, `font-weight: 500`
- Amend: `background transparent`, `border: 1px solid #9ca3af`, color `#374151`, same sizing
- Reject: `background transparent`, `border: 1px solid #fca5a5`, color `#dc2626`, same sizing

**Amend inline input** (when active)
- Text input full width of card, `border: 1px solid #d1d5db`, `border-radius: 6px`, `padding: 8px 12px`, `font-size: 14px`
- Below input: `Submit` (primary blue) and `Cancel` (neutral) buttons
- Input autofocused, stays open until Submit or Cancel

**Reject inline confirm** (when active)
- Text: `Reject this commission?` in `14px`, color `#374151`
- Buttons: `Yes, reject` (red) and `Cancel` (neutral)

**Details toggle**
- `▸ Details` / `▾ Details` — `13px`, color `#6b7280`, cursor pointer
- Expanded body: `13px`, `font-family: monospace`, `line-height: 1.5`, background `#f3f4f6`, `border-radius: 4px`, `padding: 12px`, margin-top `8px`

**NEEDS_AMENDMENT state**
- Hide buttons, show: `⏳ Awaiting revision` in `13px` muted text + the amendment note in italics below

## Constraints

- Only change the staged panel. No other part of the dashboard is touched.
- No new dependencies or external fonts.

## Success Criteria

- [ ] Staged panel rebuilt with the above spec from scratch
- [ ] No styles inherited from the rest of the dashboard
- [ ] Cards are clearly readable at a glance
- [ ] All three button actions work (Commission, Amend with inline input, Reject with inline confirm)
- [ ] NEEDS_AMENDMENT state displays correctly
- [ ] Details toggle works
- [ ] No other dashboard panels affected
