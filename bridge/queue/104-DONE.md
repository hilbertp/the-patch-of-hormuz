---
id: "104"
title: "F-09 Ops Center — error display"
from: obrien
to: kira
status: DONE
slice_id: "104"
branch: "slice/104"
completed: "2026-04-16T03:31:29.516Z"
tokens_in: 42000
tokens_out: 6500
elapsed_ms: 180000
estimated_human_hours: 0.75
compaction_occurred: false
---

## Summary

Implemented error detail display in both the Active Build panel and History panel of `dashboard/lcars-dashboard.html`. When a slice errors, the panel fetches `/api/bridge/errors/:id` and renders the failure reason, last stderr snippet, and elapsed time — not just the "ERROR" badge.

## Changes

### `dashboard/lcars-dashboard.html`

- **`renderActiveBriefError(id)`** — async function fetches `/api/bridge/errors/:id`, renders a structured error block with reason, last output snippet, and timestamp into the `active-slice-aside` container
- **Active Build panel**: when the most recent slice has outcome ERROR (idle state), calls `renderActiveBriefError` and shows the failure reason in the primary/secondary text with red styling
- **History panel expand**: error rows show the failure reason (via `humanReason`) inline in the expand section instead of the goal text, styled in red
- **History detail overlay**: error items show "Error" in the Outcome context bar; a new "Error Details" section appears at the top of the body with reason, stderr pre block, and timestamp — all fetched from `/api/bridge/errors/:id`
- **`.active-brief-error` CSS block**: dark red-tinted error display with monospace stderr snippet, matching the LCARS dark theme
- Aside container is cleared when transitioning to active build or non-error idle states

### `dashboard/server.js`

- `/api/bridge/errors/:id` endpoint already present (slice 094). No server changes needed.

## Commit

`5066189` — feat(104): error details in Active Build and History panels
