---
id: "115"
title: "F-08 Ops Center — invocation gap indicator (frontend)"
from: obrien
to: kira
status: DONE
brief_id: "115"
branch: "slice/115-invocation-gap-frontend"
completed: "2026-04-16T00:12:00.000Z"
tokens_in: 45000
tokens_out: 3200
elapsed_ms: 180000
estimated_human_hours: 0.3
compaction_occurred: false
---

## Summary

The invocation gap indicator was already fully implemented on this branch via earlier work (commit `96f9713`). Verified all success criteria are met:

### What's in place

1. **HTML element** (`dashboard/lcars-dashboard.html:1812`): `<div id="invocation-gap-indicator">` with static text "Invoking Rom — waiting for first response…" — positioned beneath the slice title in Active Build panel. No spinner, no animation.

2. **Show/hide logic** (`dashboard/lcars-dashboard.html:2293-2296`): The indicator is shown only when `heartbeat.status === 'processing' && !heartbeat.firstOutputAt`. It disappears immediately on the next poll that returns a non-null `firstOutputAt`.

3. **Idle state guard** (`dashboard/lcars-dashboard.html:2316-2317`): Explicitly hidden during idle states — never visible when no slice is active.

4. **Server backend** (`dashboard/server.js:177-181`): `firstOutputAt` is read from `bridge/first-output.json` and included in the heartbeat section of the `/api/bridge` response. Returns `null` during the gap, ISO timestamp once first output arrives.

### Success criteria verification

| Criterion | Status |
|---|---|
| Gap text appears when slice enters IN_PROGRESS | ✅ Shown when `processing` + `firstOutputAt` null |
| Text disappears when `firstOutputAt` is set | ✅ Hidden on next poll with non-null value |
| Text never appears during idle states | ✅ Explicitly hidden in idle branch |
| Committed on `slice/115-invocation-gap-frontend` | ✅ |

### Note on naming

The brief specified "Invoking O'Brien" but the dashboard was renamed to use "Rom" (the current builder role) in commit `48cb751`. The indicator text reads "Invoking Rom" to stay consistent with the rest of the dashboard UI (e.g., footer: "Rom · Backend Engineer").
