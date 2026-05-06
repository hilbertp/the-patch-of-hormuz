---
id: "296"
title: "F-Restart-1 — Idempotent startup recovery (skip already-terminal slices)"
from: rom
to: nog
status: DONE
slice_id: "296"
branch: "slice/296"
completed: "2026-05-06T08:12:00.000Z"
tokens_in: 85000
tokens_out: 12000
elapsed_ms: 540000
estimated_human_hours: 1.5
compaction_occurred: false
---

## Summary

Added `isTerminal(sliceId)` helper to `bridge/orchestrator.js` and wired it as a skip-guard in the `crashRecovery()` startup-recovery function. This closes the slice-112 ghost-resurrection bug class where already-completed slices were re-processed on orchestrator restart.

## What was done

### 1. `isTerminal(sliceId, opts)` helper (line ~2723)

Single canonical helper that returns `true` if ANY of four terminal signals exist:

1. `{id}-ACCEPTED.md` in queue directory
2. `{id}-ARCHIVED.md` in queue directory
3. `MERGED` or `SLICE_MERGED_TO_MAIN` register event (respects RESTAGED cutoff via `hasMergedEvent`)
4. `bridge/trash/{id}-*.md` archive entry

Accepts optional `{ queueDir, trashDir, regFile }` for testing. Exported in `module.exports`.

### 2. Skip-if-terminal guard in `crashRecovery()`

Added `isTerminal(id)` check at the top of all three per-file loops:

- **EVALUATING files** — skip terminal slices (no rename to DONE)
- **ACCEPTED files** — skip terminal slices (no merge re-attempt)
- **IN_PROGRESS files** — skip terminal slices (no re-queue)

On skip, emits a debug-level log: `"startup-recovery: skipped terminal slice <id>"`. No register event emitted (audit trail stays clean).

### 3. Tests (`bridge/test/startup-recovery-idempotent.test.js`)

8 tests covering:

1. DONE + ACCEPTED sibling → terminal, mtime unchanged, no register event
2. DONE + ARCHIVED sibling → terminal
3. IN_PROGRESS alone (mid-flight) → NOT terminal
4. DONE + MERGED register event (no file markers) → terminal
5. DONE + SLICE_MERGED_TO_MAIN event → terminal
6. Trash entry → terminal
7. Synthetic slice 112 (DONE + ACCEPTED + MERGED) → terminal, no DONE rewrite, no fresh register
8. Non-terminal DONE file → NOT terminal

All 8 pass. All 6 existing test files (61 tests total) pass with no regression.

## Terminal signal completeness

Verified the four signals are the complete set. No fifth terminal marker exists in the codebase. The `PARKED` suffix is a renamed commissioned file (not terminal — it's the brief's parked copy during evaluation). `STUCK` is a terminal event but handled by the MAX_ROUNDS path (slice 295) which blocks re-dispatch separately.

## Files changed

- `bridge/orchestrator.js` — `isTerminal()` helper + 3 skip guards in `crashRecovery()` + export
- `bridge/test/startup-recovery-idempotent.test.js` — 8 new tests

## No changes to

- `bridge/state/*` modules
- Mid-flight recovery logic (only added skip-guard at entry)
- No new dependencies
