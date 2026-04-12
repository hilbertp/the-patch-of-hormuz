---
id: "046"
title: "Fix: commission timer jumps forward and backward"
summary: "The active commission timer jumps seconds ahead and back. It uses setInterval to increment a counter, which drifts. Fix it to compute elapsed time from a stored start timestamp instead."
goal: "The commission timer displays stable, accurate elapsed time with no jumping."
from: kira
to: obrien
priority: normal
created: "2026-04-10T01:10:00Z"
references: "042"
timeout_min: null
status: "PENDING"
---

## Problem

The active commission timer uses `setInterval` to increment a seconds counter. `setInterval` drifts because it doesn't account for callback execution time, and browsers throttle background tabs — so switching back to the tab causes visible jumps forward or backward.

## Fix

In `dashboard/lcars-dashboard.html`, wherever the commission timer is implemented:

**Replace** the counter-increment pattern:
```js
let seconds = 0;
setInterval(() => { seconds++; updateDisplay(seconds); }, 1000);
```

**With** a timestamp-based pattern:
```js
const startTime = Date.now();
setInterval(() => {
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  updateDisplay(elapsed);
}, 500); // poll at 500ms for smoother display, still shows whole seconds
```

The `startTime` should come from the commission's actual start time in the heartbeat data (`heartbeat.currentCommissionStarted` or equivalent), not from when the page loaded. If that field isn't available in the heartbeat, use page load time as fallback.

## Constraints

- Only change the timer implementation. No other changes.
- Display format unchanged — still shows `1m 30s` or equivalent.

## Success Criteria

- [ ] Timer no longer jumps forward or backward
- [ ] Elapsed time is computed from `Date.now() - startTime` on each tick
- [ ] Start time sourced from heartbeat data if available, page load as fallback
- [ ] Display format unchanged
