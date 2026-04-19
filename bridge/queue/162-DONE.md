---
id: "162"
title: "D2 — Lifecycle completeness: terminal events + counter + return-to-stage + Nog dual-gate"
from: rom
to: nog
status: DONE
slice_id: "162"
branch: "slice/162"
completed: "2026-04-19T03:15:00.000Z"
tokens_in: 185000
tokens_out: 18000
elapsed_ms: 420000
estimated_human_hours: 3.0
compaction_occurred: false
---

## Summary

Implemented all five parts of the lifecycle completeness slice. The watcher now emits every terminal event Ziyal's wireframe specifies, and the return-to-stage backend is functional.

## What was done

### Part 1 — MAX_ROUNDS_EXHAUSTED + round counter enforcement
- Added `MAX_ROUNDS_EXHAUSTED` register event emission in the existing round >5 block of `invokeNog()` (`bridge/watcher.js`).
- Event shape: `{ ts, id, event: "MAX_ROUNDS_EXHAUSTED", round: 5, reason: "Rom exhausted 5 rounds without Nog sign-off" }`.
- No round-6 slice is commissioned (the existing block already prevented this).
- Added `cleanupWorktree(id, branchName)` call to clean up the exhausted slice's worktree.
- The existing `NOG_ESCALATION` event is preserved for backward compatibility — `MAX_ROUNDS_EXHAUSTED` is additive.

### Part 2 — ESCALATE verdict + ESCALATED_TO_OBRIEN
- Extended the Nog verdict parsing to accept `ESCALATE` alongside `PASS` and `RETURN`.
- Added a complete ESCALATE handling block in the Nog callback:
  - Emits `ESCALATED_TO_OBRIEN` register event with `{ round, reason }`.
  - Emits Kira event for dashboard visibility.
  - Transitions slice to terminal STUCK state.
  - Cleans up worktree and NOG.md verdict file.
  - Does NOT commission any new slice.

### Part 3 — ROM_WAITING_FOR_NOG
- Emits `ROM_WAITING_FOR_NOG` register event in the poll loop immediately after DONE→EVALUATING rename, before `invokeNog()` is called.
- Event includes the computed round number (derived from Nog review headers in the PARKED file).
- Only emitted on the Nog review path (not on the evaluator-only path when Nog has already passed).

### Part 4 — Return-to-stage control mechanism
- **Mechanism chosen: control file.** A JSON file dropped into `bridge/control/` is consumed by the poll loop.
- Added `CONTROL_DIR` constant (`bridge/control/`) with auto-mkdir at startup.
- Added `processControlFiles()` — called at the start of each poll cycle. Reads all `.json` files from `bridge/control/`, processes each, and moves to trash after processing.
- Added `handleReturnToStage(sliceId)`:
  - Validates slice is in a terminal state (ACCEPTED, STUCK, or ERROR file exists in queue).
  - Rejects slices in active states (IN_PROGRESS, EVALUATING, IN_REVIEW, QUEUED, PENDING) with clear logged error.
  - Rejects slices already in STAGED or not found.
  - Reads register for the most recent terminal event to populate `from_event`.
  - Emits `RETURN_TO_STAGE` register event: `{ from_event, reason: "manual" }`.
  - Updates frontmatter status to STAGED and moves file to `bridge/staged/`.
- Control file format: `{ "action": "return_to_stage", "slice_id": "<id>" }`.

### Part 5 — Nog ROLE.md dual-gate update
- Rewrote `.claude/roles/nog/ROLE.md` to define the dual-gate model:
  - **Gate 1 — ACs satisfied?** Primary gate. Each AC checked against code.
  - **Gate 2 — Quality?** Only evaluated after Gate 1 passes.
  - **Escalation condition.** ACs contradictory, impossible, or out of scope → ESCALATE.
- Added ESCALATE to the verdict table and annotation format.
- Updated relationships section (O'Brien receives ESCALATE escalations).
- Added anti-pattern #6: "Returning when you should escalate."

### Tests
- New test file: `test/lifecycle-events.test.js` with 24 tests covering:
  - MAX_ROUNDS_EXHAUSTED: emission, single-site, fields, no round-6 commission, worktree cleanup
  - ESCALATED_TO_OBRIEN: emission, single-site, fields, ESCALATE verdict handling, worktree cleanup
  - ROM_WAITING_FOR_NOG: emission, single-site, round field, ordering before invokeNog
  - RETURN_TO_STAGE: emission, fields, control dir, terminal state validation, rejection, staged movement
  - Integration: happy path simulation, rejection for IN_PROGRESS
  - Cross-cutting: existing events preserved, register append-only
- All 24 new tests pass. All 10 existing tests pass (no regressions).

## Acceptance criteria checklist

1. **MAX_ROUNDS_EXHAUSTED on round 5 Nog return** — Done. Emitted at exactly one site. No round-6 commission. Worktree cleaned up.
2. **ESCALATED_TO_OBRIEN on Nog ESCALATE** — Done. Emitted with Nog's reason text. Worktree cleaned up.
3. **ROM_WAITING_FOR_NOG on DONE→EVALUATING** — Done. Emitted before Nog subprocess starts.
4. **Return-to-stage accepts terminal slices** — Done. Emits RETURN_TO_STAGE, moves to staged/.
5. **Return-to-stage rejects non-terminal slices** — Done. IN_PROGRESS, EVALUATING, QUEUED rejected with logged error.
6. **Nog ROLE.md dual-gate definition** — Done. Gate 1 (ACs), Gate 2 (quality), escalation condition all specified.
7. **Test coverage** — Done. 24 tests covering all four events + return-to-stage happy/rejection paths.
8. **Watcher startup clean** — Verified. Syntax check passes. Existing tests pass.
9. **No register rewrites** — Confirmed. All new events are additive appends.
10. **Diff limited to bridge/, .claude/roles/nog/, test/** — Confirmed via `git diff --name-only`.

## Files changed

- `bridge/watcher.js` — Round counter enforcement, MAX_ROUNDS_EXHAUSTED + ESCALATED_TO_OBRIEN + ROM_WAITING_FOR_NOG emissions, ESCALATE verdict handling, control file mechanism, return-to-stage handler.
- `.claude/roles/nog/ROLE.md` — Dual-gate review model, ESCALATE verdict, escalation condition.
- `test/lifecycle-events.test.js` — 24 new tests (new file).

## Control mechanism design decision

Chose **control files** (JSON in `bridge/control/`) over an HTTP endpoint because:
1. Consistent with the project's file-based architecture ("files are the API").
2. No new dependencies or port binding.
3. The UI can drop a file via the same filesystem the watcher already watches.
4. Atomic: file write + rename is inherently idempotent.
5. Auditable: processed files move to trash with `.processed` suffix.
