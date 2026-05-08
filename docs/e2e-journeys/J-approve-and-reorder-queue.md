---
id: J-approve-and-reorder-queue
category: authoring-staging
status: draft
last_reviewed: 2026-05-08
---

# Approve a staged slice and reorder the queue

## What the user is trying to accomplish

Philipp reviews a staged slice in the Ops Center, decides to approve it into the execution queue, and then optionally reorders the queue by dragging slices to prioritize which work Rom picks up first.

## Preconditions

- One or more slices exist in the Staged group of the Queue panel
- Philipp is viewing the Ops Center dashboard
- Queue group is empty or has approved slices already (order matters for pickup)
- No slice is currently being dragged (fresh state)

## Steps

1. Philipp clicks a Staged row to expand it and review the full slice body
2. Philipp reads the goal, ACs, and estimated hours
3. Philipp clicks the "Approve" button in the expanded row's action group
4. The slice row animates from Staged group → approved-Queue group (per Ziyal's motion primitive)
5. The Approve button disappears; a drag handle and Edit button appear in the queue row
6. If reordering is desired: Philipp grabs the drag handle and drags the slice up or down within the queue group
7. On mouse release, the new order is persisted to `bridge/state/queue-order.json` (atomic write)
8. All queue rows animate to their new positions

## Expected outcomes

- Slice moves from Staged → Queue visually (border color changes from `--warn` to `--ok`)
- Row height may morph (queue rows are 42px; detail body closes)
- Register receives a `HUMAN_APPROVAL` event with the slice ID
- `queue-order.json` is written atomically with the new order
- Orchestrator's next poll cycle reads the new order and picks up the top-most slice accordingly
- Dragged row's opacity reduces to 0.6 during drag; drop target shows a 2px `--rom` dashed top border
- On drop, the row snaps to its final position with a 150ms ease animation

## Known failure modes

- **Approve button doesn't respond.** The server may not have a POST endpoint for `/approve/{slice_id}`. *Recovery:* Check browser console for network errors. Verify `dashboard/server.js` has the approve route wired.
- **Drag-and-drop doesn't work.** The drag handle may not have pointer-events enabled, or the page may have a conflicting event listener. *Recovery:* Check that the drag handle (6-dot grid) is visible and grab-cursor appears on hover. Try a simple drag-to-reorder; if it still fails, check browser console for JavaScript errors.
- **`queue-order.json` write fails silently.** The file may not be writable or the atomic write helper may have errored. *Recovery:* Check file permissions on `bridge/state/queue-order.json`. Verify the orchestrator has write access. Check register for any `ERROR` events.
- **Reorder persists but orchestrator ignores it.** The orchestrator's pickup loop may not be consulting `queue-order.json` on each iteration. *Recovery:* Check `bridge/orchestrator.js` pickup logic (should call `readQueueOrder()` before picking the next slice). Restart the orchestrator to force a re-read.

## Sources

- `repo/.claude/roles/obrien/inbox/HANDOFF-OPS-REDESIGN-SPEC-FROM-ZIYAL.md` — Queue panel: approved-queue rows, drag-and-drop behavior, motion primitives
- `docs/contracts/queue-lifecycle.md` — queue file format and ordering semantics
- `docs/contracts/slice-lifecycle.md` — state transition from STAGED to QUEUED
- `bridge/server.js` (or equivalent) — approve endpoint and queue-order write

## Open questions

- What happens if Philipp approves a slice while a drag operation is in progress on another slice? Is the drag aborted? Does it complete before the approve?
- The spec says "orchestrator's next poll cycle reads the new order" — what is the poll interval? Is there a visual countdown (the poll-ring component mentioned in Ziyal's spec)?
- If the drag-and-drop write to `queue-order.json` fails, should the row snap back to its original position or stay in the dropped position visually with an error toast?
