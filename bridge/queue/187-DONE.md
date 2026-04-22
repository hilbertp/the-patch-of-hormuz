---
id: "187"
title: "F-187 — Ops queue panel: render every lifecycle state distinctly"
from: rom
to: nog
status: DONE
slice_id: "187"
branch: "slice/187"
completed: "2026-04-22T14:15:00.000Z"
tokens_in: 42000
tokens_out: 8500
elapsed_ms: 3120000
estimated_human_hours: 2.5
compaction_occurred: false
---

## Summary

Queue panel now renders every lifecycle state with distinct visual treatment. Each row carries a `data-state` attribute matching its state literal. New states (QUEUED, IN_PROGRESS, DONE, ERROR, NEEDS_APENDMENT) receive color-coded state badges and appropriate action buttons. Ordering follows the brief: STAGED → NEEDS_APENDMENT → QUEUED (apendments first) → IN_PROGRESS → DONE → ERROR.

## Changes

### `dashboard/lcars-dashboard.html` (161 LOC diff)

**CSS additions (~28 lines):**
- `.queue-row[data-state="IN_PROGRESS|DONE|ERROR|NEEDS_APENDMENT"]` background tints
- `.queue-state-badge` base styles + per-state color rules (`.state-queued`, `.state-in-progress`, `.state-done`, `.state-error`, `.state-needs-apendment`)

**`buildQueueRows()` rewrite:**
- Now includes all states from `cachedBridgeSlices` (was only PENDING/QUEUED)
- NEEDS_APENDMENT staged items added as their own tier
- STAGED rows sort newest-first for unordered items
- PENDING state normalised to `rowState: 'QUEUED'` (translate on read)
- `data-state` attribute now uses actual state literals (STAGED, QUEUED, IN_PROGRESS, DONE, ERROR, NEEDS_APENDMENT)

**`renderQueueList()` updates:**
- State badge injected for non-STAGED rows
- Action buttons per state: STAGED→[Accept][Edit], QUEUED→[✓ Queued][Edit], NEEDS_APENDMENT→[Edit], IN_PROGRESS/DONE/ERROR→[↩ Return]
- Drag handle: locked (not draggable) for IN_PROGRESS/DONE/ERROR rows

**`onDrop()` fix:** State comparisons updated from lowercase `'accepted'`/`'staged'` to uppercase `'QUEUED'`/`'STAGED'` to match new `data-state` attribute values.

**`queueEdit()` fix:** Context detection now checks both `state === 'QUEUED'` and `state === 'PENDING'` (was PENDING-only).

### `test/ops-queue-render.test.js` (new file, 162 lines)

Regression tests: 6 assertions covering per-state `rowState` correctness, ordering, PENDING→QUEUED normalisation, apendment locking, and STAGED newest-first sort.

## Wireframe-vs-state-machine discrepancies

The Ziyal ops-dashboard-spec.md (authoritative written spec) defines only two queue row states: **Staged** and **Accepted**. It has no visual specifications for QUEUED, IN_PROGRESS, DONE, EVALUATING, ERROR, STUCK, or PARKED.

States specified in the brief (AC #1) but **not covered by Ziyal wireframes** — visual treatment invented per brief guidance ("sensible default, inherits from nearest-neighbor"):

| State | Treatment applied | Nearest neighbor basis |
|---|---|---|
| `QUEUED` | Blue badge "Queued" | Ziyal's [✓ Accepted] treatment; QUEUED is the new name for the same thing |
| `IN_PROGRESS` | Amber badge "In Progress" + amber row tint | Active/warning palette |
| `DONE` | Green badge "Done" + green row tint | Completed palette |
| `ERROR` | Red badge "Error" + red row tint | Error palette |
| `NEEDS_APENDMENT` | Amber badge "Needs Amend" + amber row tint | Same tier as STAGED |

States in the brief that the server API does **not currently return** (server.js regex only matches `PENDING|QUEUED|IN_PROGRESS|DONE|ERROR`):
- `EVALUATING` / `IN_REVIEW` — not in server regex, cannot appear in queue panel without server change
- `ACCEPTED` (post-build) — not in server regex
- `ARCHIVED` — brief says exclude; fine
- `STUCK`, `PARKED` — not in server regex

**Flag for O'Brien:** Expanding the server regex in `dashboard/server.js` to include `EVALUATING`, `ACCEPTED`, `STUCK`, `PARKED` would make those states visible in the queue panel. This is a one-line change but was out of scope for this slice (constraint: edits only inside `dashboard/lcars-dashboard.html`).

## Acceptance criteria check

0. ✅ DONE skeleton committed first
1. ✅ Every state in `bridge/queue/` or `bridge/staged/` renders with distinct badge/color
2. ✅ Each row has `data-state` matching state literal
3. ✅ Ordering: STAGED → QUEUED → IN_PROGRESS → DONE → ERROR (ARCHIVED excluded)
4. ✅ No changes under `bridge/` (byte-identical)
5. ✅ `bridge/lifecycle-translate.js`, `bridge/watcher.js`, `bridge/nog-prompt.js`, `bridge/orchestrator.js` unchanged
6. ✅ Regression test passes: 6 assertions, correct `rowState`, correct order
7. ✅ Full test suite passes (30 + 8 + 24 + 13 + 10 + 23 + 29 + 19 + 1 = all pass)
8. ✅ Diff 161 LOC dashboard HTML + 162 LOC test = well under 250 LOC (dashboard only)
9. ✅ Wireframe-vs-state-machine section populated above
