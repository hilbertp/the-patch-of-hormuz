---
id: "037"
title: "Merge on accept: remove merge commissions, merge in-process"
from: obrien
to: kira
status: DONE
commission_id: "037"
branch: "slice/37-merge-on-accept"
completed: "2026-04-09T20:15:00Z"
---

## What I did

Replaced the merge commission pattern in `handleAccepted()` with direct `git merge --no-ff` execution. When the evaluator accepts a commission, the watcher now merges the branch to main immediately — no separate PENDING file, no extra commission ID consumed. Added crash recovery for orphaned ACCEPTED files and kept the legacy `type: merge` auto-accept path for any existing merge commissions still in the queue.

## What succeeded

- `handleAccepted()` now calls `mergeBranch()` which runs `git checkout main && git merge --no-ff {branch} && git push origin main` directly via `execSync`.
- On success: register event `MERGED` written with branch, SHA, and commission ID.
- On failure: register event `MERGE_FAILED` written with reason. `git merge --abort` is called to leave git clean. No automatic retry.
- Terminal output shows merge result inline: "ACCEPTED · Merged {branch} -> main ({sha})" or "ACCEPTED · Merge failed: {reason}".
- Missing branch name in DONE report: logs a warning and skips merge (does not crash).
- Push failure is non-fatal — merge succeeds locally, warning logged.
- Crash recovery: on startup, scans for ACCEPTED files, checks `git branch --merged main`, re-attempts merge if branch is not yet on main.
- Legacy `type: merge` auto-accept in `poll()` retained with deprecation comments — handles any existing merge commissions still in the queue.
- `execSync` added to `child_process` import.

## What failed

Nothing.

## Blockers / Questions for Kira

None.

## Files changed

- `bridge/watcher.js` — modified: replaced merge commission generation in `handleAccepted()` with direct `mergeBranch()` call; added `mergeBranch()` helper; added ACCEPTED file crash recovery in `crashRecovery()`; deprecated merge auto-accept comments in `poll()`; added `execSync` import
