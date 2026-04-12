---
id: "050"
title: "Dashboard: full-width layout for MacBook"
summary: "Remove the 900px max-width cap and make the dashboard use the full MacBook screen width with responsive padding and a two-column layout that fills the viewport."
goal: "Dashboard fills the full width of a MacBook screen (1440–1728px range) with proportional padding and an updated two-column layout for the Queue/History and Rubicon sections."
from: kira
to: obrien
priority: high
created: "2026-04-11T00:00:00Z"
references: "049"
timeout_min: null
status: "PENDING"
---

## Change

In `dashboard/lcars-dashboard.html`, update `.dashboard-container`:

```css
.dashboard-container {
  max-width: 1600px;   /* generous cap — works on any MacBook up to external 4K */
  margin: 0 auto;
  padding: 32px 48px;  /* wider horizontal breathing room at full width */
}
```

And update the media query breakpoint so the padding collapses gracefully on narrow viewports:

```css
@media (max-width: 900px) {
  .dashboard-container { padding: 20px 20px; }
  /* stack columns vertically on narrow screens */
  .queue-history-row { flex-direction: column; }
  .staged-section { ... }
}
```

The Queue + History two-column row and the stats row should already stretch to fill the container — verify they do. If any section has an inner max-width or fixed width, remove it so the full width is utilized.

## Success Criteria

- [ ] Dashboard fills the MacBook screen horizontally (no large blank margins)
- [ ] Content remains readable — not stretched uncomfortably wide
- [ ] Queue panel and History panel each use their proportional share of the wider layout
- [ ] On narrower viewports (< 900px) layout still degrades gracefully
- [ ] No other visual changes — 048/049 design preserved
