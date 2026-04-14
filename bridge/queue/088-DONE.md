---
id: "088"
title: "Amendment 1 — fix failed criteria for brief 087"
from: obrien
to: kira
status: DONE
brief_id: "088"
branch: "slice/087-fix-history-gap"
completed: "2026-04-14T20:39:30.000Z"
tokens_in: 18000
tokens_out: 3500
elapsed_ms: 90000
estimated_human_hours: 0.3
compaction_occurred: false
---

## Summary

Amendment 088 resolved the failed AC1 from brief 087. The root cause was that `register.jsonl` was truncated to 8 lines (0 DONE events) during the merge to main — the exact problem brief 087 was designed to prevent.

## What was done

1. **Recovered full register.jsonl** from git history (`git show 99f97fd:bridge/register.jsonl`) — restored the 236-line version containing 39 original DONE events for slices 019-056 and 059-060.
2. **Preserved post-merge events** — appended the 8 current lines (086/087/088 COMMISSIONED/MERGED/REVIEWED events) that were written after the truncation.
3. **Re-ran backfill script** (`node bridge/scripts/backfill-register.js`) — added 12 synthetic DONE events for slices in 059-083 that had ACCEPTED files but no DONE events.
4. **Added DONE events for 084-086** — these were also missing from the restored version. Created synthetic DONE events from their ACCEPTED files.

## Final state

- **259 total lines** in register.jsonl
- **54 DONE events** covering: 019-031, 033-042, 044-056, 059-060, 063, 065-066, 068-069, 071-072, 076-078, 082-086
- 15 synthetic DONE events (12 from backfill script for 059-083 gap, 3 manually for 084-086)
- 39 original DONE events preserved intact
- register.jsonl remains untracked from git (verified: `git ls-files` returns empty)

## Verification

All 6 original acceptance criteria from brief 087 are met:

| AC | Status | Detail |
|----|--------|--------|
| AC1 | PASS | 15 synthetic DONE events for slices 059-083 + 084-086 that previously had none |
| AC2 | PASS | No existing DONE events duplicated or modified |
| AC3 | PASS | `git ls-files bridge/register.jsonl` returns empty |
| AC4 | PASS | `.gitignore` contains `bridge/register.jsonl` |
| AC5 | PASS | `bridge/scripts/backfill-register.js` exists and is committed |
| AC6 | PASS | Work on branch `slice/087-fix-history-gap` |
