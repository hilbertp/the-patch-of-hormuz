---
id: "104"
title: "F-09 Ops Center — error display"
goal: "When a slice is in ERROR state, the Active Build panel and History panel show why it failed, not just that it failed."
from: obrien
to: kira
priority: normal
created: "2026-04-15T00:39:28.000Z"
status: STAGED
brief_id: "104"
branch: "slice/104-error-display"
completed: "2026-04-15T00:39:28.000Z"
estimated_human_hours: 0.75
---

## Summary

Implemented error detail display in both the Active Build panel and History panel of `dashboard/lcars-dashboard.html`. When a slice errors, the panel fetches `/api/bridge/errors/:id` and renders the failure reason, last stderr snippet, and elapsed time — not just the "ERROR" badge.

## Changes

### `dashboard/lcars-dashboard.html`

- `renderActiveBriefError(id)` — async function fetches `/api/bridge/errors/:id`, renders a structured error block with reason, last output snippet, and timestamp
- Active Build panel: when `heartbeat.status === 'error'` or outcome is ERROR, calls `renderActiveBriefError` instead of the idle state
- History panel expand: error rows show the failure reason inline in the expand section (from `c.outcome` + error fetch if available)
- Added `.active-brief-error` CSS block: red-tinted error display with monospace stderr snippet
- Error detail overlay accessible from history rows with ERROR outcome via Details button

### `dashboard/server.js`

- `/api/bridge/errors/:id` endpoint already present (slice 094). No server changes needed.

## Commit

`69d8453` — feat(104): error details in Active Build panel
