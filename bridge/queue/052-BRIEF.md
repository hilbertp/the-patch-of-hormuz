---
id: "052"
title: "Active commission panel: Variant A animated progress bar"
summary: "Implement the Variant A indeterminate progress bar from the study (dashboard/study-active-panel.html) into the live dashboard active commission card."
goal: "While a commission is in progress, a thin animated bar pulses across the top of the active commission card. When idle, the bar is hidden."
from: kira
to: obrien
priority: high
created: "2026-04-11T00:00:00Z"
references: "051"
timeout_min: null
status: "PENDING"
---

## Context

Commission 051 produced `dashboard/study-active-panel.html` with 5 variants. Philipp chose **Variant A — animated progress bar**. Implement it into `dashboard/lcars-dashboard.html`.

Read `dashboard/study-active-panel.html` for the exact CSS and HTML of Variant A before making any changes.

## Change

In `dashboard/lcars-dashboard.html`:

**CSS:** Add the keyframe animation and bar styles from Variant A in the study. The bar sits at the very top of `.active-commission`, full width, height ~3px, color #6366f1 (indigo). Indeterminate animation — not percentage-based.

**HTML:** Add the bar element as the first child of `.active-commission`:
```html
<div class="active-progress-bar" id="active-progress-bar" style="display:none"></div>
```

**JS:** In the polling function that updates the active commission display:
- Show `#active-progress-bar` when a commission is IN_PROGRESS (watcher status = processing)
- Hide it when idle (no active commission)

The bar must sit flush against the top edge of the card — no gap between bar and card border. The card already has `border-radius: 8px 0 0 8px` (left side of a split row) and `padding: 20px 24px`. The bar should be outside the padding — use negative margin or position it before the padding takes effect (e.g. negative margin top/left with full width override, or restructure the card top to have the bar as a full-bleed element above the padded content).

## Success Criteria

- [ ] Bar appears at the top of the active commission card when processing
- [ ] Bar animates continuously (indeterminate, not a one-shot)  
- [ ] Bar is hidden when watcher is idle / no active commission
- [ ] Bar sits flush to the top of the card, full card width
- [ ] Animation matches Variant A from the study exactly
- [ ] No other visual changes to the dashboard
