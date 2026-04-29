---
id: "264"
title: "F-Ops-Unapprove — Un-approve queue row → back to staged"
from: rom
to: nog
status: DONE
slice_id: "264"
branch: "slice/264"
completed: "2026-04-29T16:35:00.000Z"
tokens_in: 78000
tokens_out: 4200
elapsed_ms: 420000
estimated_human_hours: 1.5
compaction_occurred: false
---

## Summary

Implemented the un-approve feature: a ghost-style button (↶) on queued (approved) rows that moves them back to the staged group, mirroring the Approve action symmetrically.

## Changes

### `dashboard/server.js`
- Added `POST /api/slice/:id/unapprove` handler (lines ~1005–1055)
- Race protection: reads `heartbeat.json` to check if the slice is the currently-dispatched slice; returns 409 `{"error":"already-picked-up"}` if so
- Moves `{id}-QUEUED.md` from `bridge/queue/` → `{id}-STAGED.md` in `bridge/staged/`, updating frontmatter status
- Atomically updates `queue-order.json` (removes) and `staged-order.json` (appends)
- Emits `slice-unapproved` register event with `slice_id`, `ts`, and `prev_position`
- Reuses the same synchronous single-threaded write pattern as the existing approve handler (no new locking primitive)

### `dashboard/lcars-dashboard.html`
- **Button**: Added `queue-btn-unapprove` ghost button (↶ symbol, `&#8630;`) to queued rows, placed left of Edit. Hidden when the row is the currently-active in-pipeline slice (checked via `_lastBridgeData.heartbeat.current_slice`)
- **Click handler** (`queueUnapprove`): Plays exit animation (250ms slide+fade via existing `.row-exiting` class), POSTs to `/api/slice/:id/unapprove`, updates client-side cached order arrays, triggers re-render with enter animation
- **409 handling**: On conflict (already picked up), removes exit animation, shows inline message "Already picked up — use Stop build instead" for 4 seconds
- **CSS**: Added `.queue-btn-unapprove` styling, `.unapprove-conflict-msg` with fade-in animation, `:focus-visible` with 2px solid `--info` outline + 2px offset
- **Reduced motion**: Added `@media (prefers-reduced-motion: reduce)` rules that replace slide+fade with a 100ms cross-fade for both `.row-exiting` and `.row-entering`
- **Keyboard**: Native `<button>` element is focusable; Enter/Space triggers click; focus-visible outline matches other ghost buttons

## Acceptance criteria

1. ✅ Each queued row renders an un-approve ghost button left of Edit, except for the in-pipeline row (hidden)
2. ✅ Clicking triggers slide+fade-out → fade-in animation, row ends up at bottom of staged group
3. ✅ `queue-order.json` updated (slice removed); `staged-order.json` updated (slice appended)
4. ✅ `register.jsonl` receives `slice-unapproved` event with timestamp and prev_position
5. ✅ 409 path: inline "Already picked up — use Stop build instead" message; row does NOT move
6. ✅ Keyboard focus reaches button; Enter/Space triggers action
7. ✅ `prefers-reduced-motion: reduce` → 100ms cross-fade, no slide
8. ✅ Existing Approve / Edit / ✕ behaviors unchanged (additive only)

## Files changed

- `dashboard/server.js` — added unapprove route
- `dashboard/lcars-dashboard.html` — button, handler, CSS, reduced-motion
- `bridge/queue/264-DONE.md` — this report
