---
id: "152"
title: "dashboard: stop showing pre-review DONE slices in history; fix amendment_required string"
from: rom
to: nog
status: DONE
slice_id: "152"
branch: "slice/152"
completed: "2026-04-17T00:10:00.000Z"
tokens_in: 28000
tokens_out: 4500
elapsed_ms: 180000
estimated_human_hours: 0.3
compaction_occurred: false
---

## Summary

Two minimal fixes to the Ops Center dashboard:

1. **History filter fix** (`dashboard/lcars-dashboard.html`, line ~2399): Removed the `outcome === 'DONE'` clause from `renderHistoryPanel`'s filter. The filter now only includes `outcome === 'ERROR' || c.reviewStatus === 'accepted'`. This prevents slices that have emitted DONE but not yet received ACCEPTED/MERGED from appearing in the history panel with a false "merged" pill. Updated the comment to describe the new semantics.

2. **amendment_required string fix** (`dashboard/server.js`, line 252): Replaced the bogus regex-alternation string `'(approve|slice|amend|reject|update-body)ment_required'` with the correct literal `'amendment_required'`. This ensures that when Nog returns `AMENDMENT_REQUIRED`, the `reviewStatus` field is set to the string the HTML template actually matches against.

## Register trace

`bridge/register.jsonl` is a runtime-only file (untracked since slice 087) and does not exist in the git tree. Tracing is done by code analysis instead:

- **Accepted slice (e.g. slice 143):** The register would contain `DONE`, `NOG_PASS`, `ACCEPTED`, `MERGED` events. `acceptedSet.has('143')` → true → `reviewStatus = 'accepted'`. The new filter `c.reviewStatus === 'accepted'` → **included in history**. Correct.

- **In-review slice (just emitted DONE, no ACCEPTED/MERGED yet):** `acceptedSet.has(id)` → false, no verdict in `reviewedMap` → `reviewStatus = 'waiting_for_review'`. The new filter: `outcome === 'ERROR'` is false (outcome is DONE), `c.reviewStatus === 'accepted'` is false → **excluded from history**. Correct — it stays in the Nog lane.

- **ERROR slice:** `outcome === 'ERROR'` → **included in history**. Correct.

## Acceptance criteria verification

All criteria pass:
- `grep -nc "outcome === 'DONE' ||" dashboard/lcars-dashboard.html` → 0
- `grep -nc "outcome === 'ERROR' || c.reviewStatus === 'accepted'" dashboard/lcars-dashboard.html` → 1
- `grep -nc "(approve|slice|amend|reject|update-body)ment_required" dashboard/server.js` → 0
- `grep -nc "reviewStatus = 'amendment_required'" dashboard/server.js` → 1
- `node -c dashboard/server.js` → exit 0
- `git diff --stat main` → exactly 2 files changed

## Files changed
- `dashboard/lcars-dashboard.html` — `renderHistoryPanel` filter updated
- `dashboard/server.js` — `amendment_required` string literal fixed
