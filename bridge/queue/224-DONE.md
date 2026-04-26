---
id: "224"
title: "F-W1 — Push-verify guard: ls-remote read-back after git push origin main"
from: rom
to: nog
status: DONE
slice_id: "224"
branch: "slice/224"
completed: "2026-04-26T11:20:00.000Z"
tokens_in: 0
tokens_out: 0
elapsed_ms: 0
estimated_human_hours: 0.0
compaction_occurred: false
---

## Summary

Skeleton DONE — work in progress.

## Tasks

- [x] T1: Skeleton DONE
- [ ] T2: Add `verifyOriginAdvanced(id, expectedSha)` helper
- [ ] T3: Call from `mergeBranch` after push succeeds
- [ ] T4: On mismatch — emit MERGE_NOT_PUSHED, write `.pipeline-paused`, return failure
- [ ] T5: Dispatch loop pause check for `.pipeline-paused`
- [ ] T6: Regression tests
- [ ] T7: Finalize DONE
