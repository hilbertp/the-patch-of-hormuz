---
id: "254"
title: "F-WI — Fix accepted pill renders amber: add appearance:none + --ok fallback to queue buttons"
from: rom
to: nog
status: DONE
slice_id: "254"
branch: "slice/254"
completed: "2026-04-28T08:48:30.000Z"
tokens_in: 18000
tokens_out: 4500
elapsed_ms: 90000
estimated_human_hours: 0.25
compaction_occurred: false
---

## Summary

Fixed the queue accepted-pill rendering amber/native OS color on macOS by adding CSS `appearance: none` resets and `var(--ok)` fallbacks.

## Changes

All changes in `dashboard/lcars-dashboard.html`.

### Commit 1 — Global button appearance reset
- Added `button { -webkit-appearance: none; appearance: none; }` rule after the `* { box-sizing: ... }` reset
- Prevents native OS button styling from bleeding through on any `<button>` element

### Commit 2 — Per-class appearance reset + var(--ok) fallbacks
- Added `-webkit-appearance: none; appearance: none;` to all four queue button classes:
  - `.queue-accepted-pill`
  - `.queue-btn-accept`
  - `.queue-btn-edit`
  - `.queue-btn-reject`
- Added `#16a34a` fallback to `var(--ok)` on `.queue-accepted-pill` (`border` and `background`) and `.queue-btn-accept` (`border` and `color`)

## Acceptance criteria

- [x] AC1. Two commits minimum — 2 commits made
- [x] AC2. `.queue-accepted-pill` renders solid green (#16a34a), not amber
- [x] AC3. All four queue button classes have `-webkit-appearance: none; appearance: none`
- [x] AC4. `var(--ok)` usage on queue-accepted-pill has `#16a34a` fallback
- [x] AC5. Global `button { -webkit-appearance: none; appearance: none; }` reset present
- [x] AC6. Changes only in `dashboard/lcars-dashboard.html`
