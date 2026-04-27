---
id: "242"
title: "F-WI — Silence startup audit noise: skip rev-list for branches that don't exist"
from: rom
to: nog
status: DONE
slice_id: "242"
branch: "slice/242"
completed: "2026-04-27T17:02:00.000Z"
tokens_in: 85000
tokens_out: 4500
elapsed_ms: 180000
estimated_human_hours: 0.3
compaction_occurred: false
---

## Summary

Added a branch-existence guard to `verifyRomActuallyWorked()` so that `git rev-list ${branchName} ^main --count` is never called for deleted branches. Also hardened the `crashRecovery()` startup path by adding explicit `stdio: ['pipe','pipe','pipe']` to the `rev-parse --verify` call that checks branch existence for orphaned ACCEPTED files.

## Changes

- `bridge/orchestrator.js`: Added `git rev-parse --verify refs/heads/${branchName}` guard before the `rev-list` call in `verifyRomActuallyWorked()` — returns `{ ok: true }` immediately if the branch doesn't exist (deleted after merge/cleanup).
- `bridge/orchestrator.js`: Added explicit `execOpts: { stdio: ['pipe','pipe','pipe'] }` to the `rev-parse --verify` call in `crashRecovery()` to suppress any stderr leakage for missing branches.

## Acceptance criteria

| AC | Status | Notes |
|----|--------|-------|
| AC1 | PASS | Two commits: skeleton + DONE |
| AC2 | PASS | Branch-existence check returns early before rev-list can emit fatal error |
| AC3 | PASS | Existing branches pass the rev-parse guard and proceed to rev-list as before |
| AC4 | PASS | Only `bridge/orchestrator.js` modified |
