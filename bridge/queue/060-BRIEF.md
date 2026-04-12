---
id: "060"
title: "Fix timer stale anchor when commission changes without idle gap"
goal: "The active build timer always shows the correct elapsed time for the current commission without requiring a page reload."
from: kira
to: obrien
priority: normal
created: "2026-04-12T00:00:00Z"
references: null
timeout_min: 10
branch: "fix/60-timer-anchor"
status: "PENDING"
---

## The bug

In `dashboard/lcars-dashboard.html`, `commissionStartTime` is anchored once (`if (commissionStartTime == null)`) and only reset to null when no active mission is present. If commission A finishes and commission B starts before the next poll catches an idle state, `commissionStartTime` still holds A's anchor. The timer for B shows A's elapsed time. A page reload fixes it because the variable resets.

## The fix

Add a `lastCommissionId` tracking variable alongside `commissionStartTime`. Re-anchor whenever the commission ID changes, not just when `commissionStartTime` is null.

### Step 1 — Add `lastCommissionId` declaration

Find the line (around line 941):
```js
  let commissionStartTime = null;
```

Change to:
```js
  let commissionStartTime = null;
  let lastCommissionId    = null;
```

### Step 2 — Update the anchor condition

Find (around line 1004):
```js
      if (heartbeat.commission_elapsed_seconds != null) {
        // Derive start time once; don't re-anchor on subsequent polls
        if (commissionStartTime == null) {
          commissionStartTime = Date.now() - (heartbeat.commission_elapsed_seconds * 1000);
        }
```

Change to:
```js
      if (heartbeat.commission_elapsed_seconds != null) {
        // Re-anchor when commission changes or on first load
        if (commissionStartTime == null || mission.id !== lastCommissionId) {
          commissionStartTime = Date.now() - (heartbeat.commission_elapsed_seconds * 1000);
          lastCommissionId    = mission.id;
        }
```

### Step 3 — Reset `lastCommissionId` alongside `commissionStartTime`

Find (around line 1019):
```js
      commissionStartTime = null;
```

Change to:
```js
      commissionStartTime = null;
      lastCommissionId    = null;
```

## Constraints

- New branch: `fix/60-timer-anchor`
- Touch only `dashboard/lcars-dashboard.html`
- No other changes

## Success criteria

1. `lastCommissionId` declared alongside `commissionStartTime`
2. Anchor condition checks `mission.id !== lastCommissionId` in addition to `commissionStartTime == null`
3. Both variables reset together in the idle/no-mission branch
4. DONE report includes all 5 metrics fields with real non-null values
