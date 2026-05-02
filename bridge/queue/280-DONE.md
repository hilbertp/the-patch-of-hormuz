---
id: "280"
title: "W-History-1 — History pill states for the gate flow (on dev / merged / deferred / error)"
from: rom
to: nog
status: DONE
slice_id: "280"
branch: "slice/280"
completed: "2026-05-02T14:02:00.000Z"
tokens_in: 42000
tokens_out: 6500
elapsed_ms: 780000
estimated_human_hours: 1.5
compaction_occurred: false
---

## Summary

Replaced the binary `merged | error` History pill with a four-state pill reflecting the gate flow:

| Pill | Meaning | CSS class | Color |
|---|---|---|---|
| `merged` | On main (via gate or legacy) | `outcome-merged` | green |
| `on dev` | Squashed to dev, awaiting Bashir gate | `outcome-on-dev` | blue |
| `deferred` | Squash held back while gate was running | `outcome-deferred` | amber |
| `error` | Genuine failure | `outcome-error` | red |

## Changes

### Backend — `dashboard/server.js`
- Built `squashedToDevIds` and `deferredIds` sets from register events (`SLICE_SQUASHED_TO_DEV`, `SLICE_DEFERRED`), with cleanup: merged IDs removed from squashed set, squashed/merged IDs removed from deferred set.
- Extracted `deriveHistoryOutcome()` — pure function implementing priority: merged → on-dev → deferred → accepted-override → raw outcome. Exported for testing.
- Replaced inline outcome logic in the History `.map()` with a call to `deriveHistoryOutcome()`.
- Added `SLICE_MERGED_TO_MAIN` to the `mergedIds` collector (alongside legacy `MERGED`).

### Backend — `bridge/orchestrator.js`
- Added per-slice `SLICE_MERGED_TO_MAIN` register event emission in `mergeDevToMain()` (step 8), one event per slice ID when dev→main succeeds. This ensures gate-merged slices show as "merged" in the dashboard.

### Frontend — `dashboard/lcars-dashboard.html`
- Added CSS classes: `.outcome-on-dev` (blue `#dbeafe`/`#1e40af`), `.outcome-deferred` (amber `#fef3c7`/`#92400e`).
- Updated `outcomeHtml()` to handle `ON_DEV`, `DEFERRED`, and `ACCEPTED` states with appropriate pill rendering.
- Added hover tooltips on "on dev" and "deferred" pills explaining the state.

### Tests — `bridge/test/history-pill-outcomes.test.js`
- 8 scenarios covering: squashed-to-dev, merged-via-gate, merged-via-legacy, deferred, plain-error, error-with-accept, merged-priority-over-squashed, plain-DONE passthrough.
- All 8 pass.

## Acceptance criteria status

1. ✅ Four distinct outcome pills rendered: merged (green), on dev (blue), deferred (amber), error (red), plus accepted for historical entries.
2. ✅ Slice 277 pattern (ERROR + accepted) shows `on dev` — not `error`.
3. ✅ Backend test passes with 8 scenarios (exceeds the 5 minimum).
4. ✅ Tooltips on `on dev` and `deferred` explain the state.
5. ✅ Existing `merged` slices (post-gate or pre-gate) still render `merged` in green.
6. ✅ No cache freshness regression — `_bridgeDataCache` still invalidates on REGISTER mtime change (no changes to caching layer).

## Files changed

- `dashboard/server.js` — outcome derivation logic + new ID sets
- `dashboard/lcars-dashboard.html` — pill CSS + outcomeHtml() states + tooltips
- `bridge/orchestrator.js` — SLICE_MERGED_TO_MAIN emission in mergeDevToMain()
- `bridge/test/history-pill-outcomes.test.js` — new test file (8 scenarios)
- `bridge/queue/280-DONE.md` — this report
