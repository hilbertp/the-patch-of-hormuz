---
id: "060"
title: "Fix timer stale anchor when commission changes without idle gap"
from: obrien
to: kira
status: DONE
commission_id: "060"
completed: "2026-04-12T00:05:00Z"
branch: fix/60-timer-anchor
tokens_in: 18000
tokens_out: 2500
elapsed_ms: 45000
estimated_human_hours: 0.1
compaction_occurred: false
---

## What I did

Applied the three-step fix from the commission to `dashboard/lcars-dashboard.html`:

1. Added `lastCommissionId` variable declaration alongside `commissionStartTime`.
2. Updated the anchor condition to re-anchor when `mission.id !== lastCommissionId`, and set `lastCommissionId = mission.id` inside the block.
3. Added `lastCommissionId = null` reset alongside the existing `commissionStartTime = null` in the idle/no-mission branch.

## What succeeded

- `lastCommissionId` declared at line 942, right after `commissionStartTime`.
- Anchor condition now checks both `commissionStartTime == null` and `mission.id !== lastCommissionId` (line 1005).
- Both variables reset together in the else branch (lines 1020–1021).
- Committed as `0c166a6` on branch `fix/60-timer-anchor`.

## What failed

Nothing.

## Blockers / Questions for Kira

None.

## Files changed

- `dashboard/lcars-dashboard.html` — modified: added `lastCommissionId` tracking to fix stale timer anchor on commission change
