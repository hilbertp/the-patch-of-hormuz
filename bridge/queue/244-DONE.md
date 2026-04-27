---
id: "244"
title: "F-S5-0a — Extract design tokens to dashboard/tokens.css"
from: rom
to: nog
status: DONE
slice_id: "244"
branch: "slice/244"
completed: "2026-04-27T20:18:30.000Z"
tokens_in: 95000
tokens_out: 12000
elapsed_ms: 340000
estimated_human_hours: 1.0
compaction_occurred: false
---

## Summary

Created `dashboard/tokens.css` with all CSS custom properties from Ziyal's design spec and integrated it into the dashboard.

## What was done

### Part 1 — Created `dashboard/tokens.css`
All token categories from the spec: surfaces, lines, ink, semantic colors (ok/warn/err/info), role identity, branch tracks, radii, shadows, and motion.

### Part 2 — Import + server route
- Added `<link rel="stylesheet" href="/tokens.css">` as the first stylesheet in `<head>` of `lcars-dashboard.html`
- Added `/tokens.css` route to `dashboard/server.js` (server uses explicit routes, not a static file handler)

### Part 3 — Hardcoded value sweep
Replaced ~134 hardcoded hex values in `lcars-dashboard.html` CSS with `var(--token)` references:
- `#f9fafb` → `var(--bg-subtle)` (11 occurrences)
- `#ffffff` → `var(--bg-panel)` (10 occurrences, white text left as-is)
- `#f3f4f6` → `var(--bg-hover)` (all occurrences)
- `#e5e7eb` → `var(--border)` (28 occurrences)
- `#d1d5db` → `var(--border-strong)` (all CSS occurrences)
- `#0f172a` → `var(--ink)` (1 occurrence)
- `#16a34a` → `var(--ok)` (12 occurrences)
- `#f0fdf4` → `var(--ok-bg)`, `#bbf7d0` → `var(--ok-border)`
- `#fffbeb` → `var(--warn-bg)`, `#fde68a` → `var(--warn-border)`
- `#b91c1c` → `var(--err)`, `#fef2f2` → `var(--err-bg)`, `#fecaca` → `var(--err-border)`
- `#1d4ed8` → `var(--info)`, `#eff6ff` → `var(--info-bg)`, `#bfdbfe` → `var(--info-border)`

### Intentionally untouched
- `:root` block definitions (existing CSS variable declarations)
- `color: #ffffff` (white text on colored backgrounds — intentional one-offs)
- `color: #e5e7eb` (text color in tooltip/drag handle contexts)
- Inline `style=""` attributes in HTML body
- JavaScript code setting `style.border`

## Commits

1. `54c789e` — create dashboard/tokens.css + import + server route
2. `9789f09` — replace hardcoded hex values with design token references

## Files changed

- `dashboard/tokens.css` (new)
- `dashboard/lcars-dashboard.html` (import + sweep)
- `dashboard/server.js` (tokens.css route)

## Acceptance criteria

- [x] AC1. Two commits minimum
- [x] AC2. `dashboard/tokens.css` exists and declares all tokens from the spec
- [x] AC3. `tokens.css` is imported as the first stylesheet in `lcars-dashboard.html`
- [x] AC4. `/tokens.css` is served by `dashboard/server.js`
- [x] AC5. Most-used hardcoded hex values replaced with `var(--token)` references
- [x] AC6. No visual regression — identity-safe replacements (same values)
- [x] AC7. Changes only in `dashboard/tokens.css`, `dashboard/lcars-dashboard.html`, and `dashboard/server.js`
