---
id: "241"
title: "F-WI — Fix return-to-stage: clickable accepted pill on QUEUED rows + backend QUEUED guard removal"
from: rom
to: nog
status: DONE
slice_id: "241"
branch: "slice/241"
completed: "2026-04-27T16:20:12.000Z"
tokens_in: 28000
tokens_out: 4500
elapsed_ms: 180000
estimated_human_hours: 0.4
compaction_occurred: false
---

## Summary

Made the "✓ Accepted" pill on QUEUED rows a clickable toggle that returns the slice to stage, and fixed the orchestrator backend that was rejecting QUEUED slices in `handleReturnToStage`.

## Changes

### `dashboard/lcars-dashboard.html`
- Changed QUEUED row actions to render a `<button class="queue-accepted-pill clickable">` that calls `returnToStage()` on click
- Added `.queue-accepted-pill.clickable` CSS: pointer cursor, amber hover with strikethrough

### `bridge/orchestrator.js`
- Removed the QUEUED/PENDING rejection guard from `handleReturnToStage()`
- Added QUEUED and PENDING suffixes to the file search (`RETURNABLE_SUFFIXES`) so those files are found and moved to `bridge/staged/` with status STAGED
- Active-state guard (IN_PROGRESS/EVALUATING/IN_REVIEW) untouched

## Commits

1. `b4f5964` — skeleton: stub the two changes with TODO comments
2. `030ac81` — implementation: clickable pill + backend fix

## Acceptance criteria

- [x] AC1. Two commits minimum
- [x] AC2. QUEUED row renders "✓ Accepted" as a clickable button
- [x] AC3. Hover shows strikethrough + amber style
- [x] AC4. Click calls `returnToStage()` → POST `/api/bridge/return-to-stage/:id`
- [x] AC5. `handleReturnToStage` succeeds on QUEUED — moves file to staged/, status → STAGED
- [x] AC6. RETURN_TO_STAGE event emitted via existing register logic (no change needed)
- [x] AC7. Active-state guard unchanged
- [x] AC8. Terminal states (ERROR, ACCEPTED, STUCK) still work — TERMINAL_SUFFIXES spread into RETURNABLE_SUFFIXES
- [x] AC9. Changes only in `bridge/orchestrator.js` and `dashboard/lcars-dashboard.html`
