---
id: "281"
title: "W-History-2 — Drop the merged pill from the History panel"
from: rom
to: nog
status: DONE
slice_id: "281"
branch: "slice/281"
completed: "2026-05-02T14:02:00.000Z"
tokens_in: 28000
tokens_out: 4500
elapsed_ms: 240000
estimated_human_hours: 0.5
compaction_occurred: false
---

## Summary

Removed the `merged` outcome state from the History panel. Three pills remain: **on dev**, **deferred**, **error**.

## Changes

### Backend — `dashboard/server.js`

- **`deriveHistoryOutcome`**: Removed `mergedIds` parameter and the `mergedIds.has(id)` arm. Added fallback: if `rawOutcome === 'MERGED'` (historical pre-gate slices), maps to `ON_DEV`.
- **`buildBridgeData`**: Removed the `mergedIds`-based cleanup of `squashedToDevIds` and `deferredIds`. `mergedIds` is still computed but only for the terminal-ID set (used by Queue panel filtering), not passed to pill derivation.
- Call site updated to pass three sets instead of four.

### Frontend — `dashboard/lcars-dashboard.html`

- Removed `.outcome-merged` CSS class.
- Removed `case 'MERGED'` from `outcomeHtml()` switch.
- Changed `ACCEPTED` and default cases to use `outcome-on-dev` class instead of `outcome-merged`.

### Tests — `bridge/test/history-pill-outcomes.test.js`

- Removed scenarios 2, 3, 7 (all MERGED-based).
- Added scenario 2: historical pre-gate slice with `MERGED` rawOutcome resolves to `ON_DEV`.
- Renumbered remaining scenarios. All 6 pass.

## Acceptance criteria

1. History panel renders three pills only: on dev, deferred, error. No merged pill. **DONE**
2. Historical pre-gate slices (MERGED event, no SLICE_SQUASHED_TO_DEV) render as on dev. **DONE**
3. Tests updated; all 6 scenarios pass. **DONE**
4. MERGED events still flow through register; Gate Health and costs panels unaffected. **DONE** (mergedIds still computed for terminalIds set)
