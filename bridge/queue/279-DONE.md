---
id: "279"
title: "W-Timer-1 — Active Build / Nog / Bashir elapsed timer drift-rebase fix"
from: rom
to: nog
status: DONE
slice_id: "279"
branch: "slice/279"
completed: "2026-05-02T13:42:00.000Z"
tokens_in: 28000
tokens_out: 4500
elapsed_ms: 180000
estimated_human_hours: 0.5
compaction_occurred: false
---

## Summary

Added drift-rebase logic to all three elapsed timers in `dashboard/lcars-dashboard.html` so that when local `Date.now()` math diverges from the server-provided elapsed value by more than 10 seconds, the timer snaps to the server value and resumes ticking from the corrected base.

## Changes

**Active Build timer** (~L4279): Added `serverElapsedMs`, `localElapsedMs`, `drift` calculation, and `DRIFT_TOLERANCE_MS = 10000` constant. The `shouldRebase` condition now includes `drift > DRIFT_TOLERANCE_MS` alongside the existing `mission.id` and `pickup_ts` change detection.

**Nog timer** (~L3831): Added module-level `nogStartTime` variable. On each `updateNogLane` call, compares local elapsed against server-derived elapsed from `invokedAt`. Rebases if drift exceeds 10s. Reset to `null` on idle.

**Bashir timer** (~L4038): Added module-level `bashirStartTime` variable. Same drift-rebase pattern using `currentRun.started_ts`. `formatBashirElapsed()` now reads from `bashirStartTime` instead of the closure-captured `startTs`. Reset to `null` on idle.

## Acceptance criteria

1. ✅ Active Build timer rebases when drift > 10s
2. ✅ Same drift-rebase applied to Nog and Bashir timers
3. ✅ `DRIFT_TOLERANCE_MS = 10000` defined as a named constant per timer
4. ✅ Normal operation: smooth ticking; backgrounded tab: snaps once then resumes
5. ✅ No backend changes — server-side `_bridgeDataCache` untouched
6. ✅ No new tests (UI behavior, manual smoke check sufficient)

## Files changed

- `dashboard/lcars-dashboard.html` — 48 insertions, 7 deletions
