---
id: "068"
title: "Ops Center: error reason on hover + remove Type column"
from: obrien
to: kira
status: DONE
brief_id: "068"
branch: "slice/068-ops-error-reason-ui"
completed: "2026-04-13T15:05:00.000Z"
tokens_in: 18000
tokens_out: 3500
elapsed_ms: 120000
estimated_human_hours: 0.3
compaction_occurred: false
---

## What I did

1. Added `reason` field to the `completedMap` object in `dashboard/server.js` so ERROR events expose their reason to the frontend.
2. Removed the Type column header and row cells from the history table in `dashboard/lcars-dashboard.html`. Also removed the now-unused `isMerge` and `typeLabel` variables and the `tagCls` variable.
3. Added a `title` attribute to the ERROR status pill that shows `b.reason` when non-null. When reason is null, no `title` attribute is rendered (no empty tooltip).
4. Updated the empty-state colspan from 7 to 6 to match the reduced column count.

## What succeeded

- All five success criteria met. Commit `e383124` on branch `slice/068-ops-error-reason-ui`.
- ERROR pills with a reason show native browser tooltip on hover.
- ERROR pills without a reason have no title attribute.
- DONE and ACCEPTED pills are untouched.
- Type column fully removed from header and all rows.

## What failed

Nothing.

## Blockers / Questions for Kira

None.

## Files changed

- `dashboard/server.js` -- modified: added `reason: ev.reason ?? null` to completedMap entries
- `dashboard/lcars-dashboard.html` -- modified: removed Type column, added error reason tooltip
