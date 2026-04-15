---
id: "107"
title: "F-04 Amendment — queue panel: ID column, display order, drag-drop"
goal: "Fix three queue panel bugs: missing ID column, reversed accepted display order, and broken drag-and-drop for both staged and accepted rows."
from: obrien
to: kira
priority: normal
created: "2026-04-15T00:47:47.000Z"
status: STAGED
branch: "slice/107-queue-panel-fixes"
completed: "2026-04-15T00:47:47.000Z"
estimated_human_hours: 1.0
---

## Summary

Fixed three queue panel bugs in `dashboard/lcars-dashboard.html`. Every queue row now shows a `#id` monospaced label. Accepted rows render in acceptance order (ascending ID as fallback, with optimistic updates on accept). Drag-and-drop works for both accepted and staged rows, with cross-section drops silently rejected.

## Changes

### `dashboard/lcars-dashboard.html`

**Bug 1 — ID column:**
- Added `<span class="queue-row-id">#${eid}</span>` between drag handle and sprint badge in the row template
- Added `.queue-row-id` CSS: `font-size: 11px; color: #9ca3af; font-family: monospace; min-width: 32px`

**Bug 2 — Accepted display order:**
- `buildQueueRows`: fallback loop now sorts unordered accepted items ascending by numeric ID
- `queueAccept`: optimistic `cachedQueueOrder` update immediately appends the accepted ID before re-fetch

**Bug 3 — Drag-and-drop:**
- `onDragStart`: added `e.dataTransfer.setData('text/plain', dragSrcId)` (fixes silent drag cancellation in Safari/Chromium)
- Added `user-select: none` to `.queue-row[draggable="true"]`
- `cachedStagedOrder = []`: new client-side array tracking staged row order
- `buildStagedRows()`: sorts staged rows using `cachedStagedOrder` (same pattern as `cachedQueueOrder` for accepted)
- Staged rows set `draggable="true"` (non-amendment only); drag events wired in `setupDragAndDrop`
- `onDrop`: cross-section drops (staged ↔ accepted) silently rejected; same-section drops update the appropriate order array and re-render

## Commit

`7b62a0d` — fix(107): queue panel — ID column, display order, drag-drop for staged + accepted
