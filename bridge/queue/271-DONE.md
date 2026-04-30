---
id: "271"
title: "F-Bash-9 — Gate-fail UX (Investigate / Abort, GATE_FAILED surfacing)"
from: rom
to: nog
status: DONE
slice_id: "271"
branch: "slice/271"
completed: "2026-04-30T16:05:00.000Z"
tokens_in: 95000
tokens_out: 12000
elapsed_ms: 1200000
estimated_human_hours: 4.0
compaction_occurred: false
---

## Summary

Implemented the gate-fail UX: when a regression gate fails, the dashboard now surfaces the full list of failing ACs with actionable Investigate and Abort buttons. The Abort button clears the GATE_FAILED state back to ACCUMULATING so the user can commission a hotfix and re-run the gate.

## Changes

### 1. Orchestrator — `abortGate()` (bridge/orchestrator.js)

New exported function that:
- Validates `gate.status` is `GATE_FAILED` or `GATE_ABORTED` (throws `INVALID_STATE` otherwise)
- Transitions `gate.status` to `ACCUMULATING` (not IDLE — dev has commits ahead)
- Preserves `gate.last_failure` for audit trail
- Clears `gate.current_run`
- Emits `gate-abort` telemetry with `reason: "user-abort"`
- Defensively releases gate mutex if somehow still present (state corruption recovery)

### 2. Server route — `POST /api/gate/abort` (dashboard/server.js)

- Returns 200 with cleared gate state on success
- Returns 409 if `gate.status` is not `GATE_FAILED` or `GATE_ABORTED`
- Returns 503 if branch-state.json is unavailable

Also added two supporting endpoints:
- `GET /api/gate/doctor` — wraps `state-doctor.js --gate-health` for the Investigate panel
- `GET /api/gate/register-tail` — returns last 50 gate-related register events

### 3. GATE_FAILED step-card body (dashboard/lcars-dashboard.html)

When `gate.status === 'GATE_FAILED'`, Step 2 now renders:
- Headline: "Regression gate failed — N ACs not met"
- Failed ACs list from `gate.last_failure.failed_acs[]`, each showing `slice <id>: AC <index> · <test_path> · <excerpt truncated to 80 chars>`. Click to expand full excerpt.
- **Investigate** button (`.btn` variant) — opens a side panel with state-doctor output, register tail since gate-start, and a link to regression-stdout.log
- **Abort gate** button (`.btn-stop` variant) — inline confirmation pill (Abort? Yes/No), then POSTs `/api/gate/abort`

### 4. Header pill stays BATCH GATE during GATE_FAILED

Updated the `fetchBranchState` health pill override to keep `BATCH GATE` (degraded) state for both `GATE_RUNNING` and `GATE_FAILED`. Only transitions away when gate enters `ACCUMULATING` (via abort) or `IDLE` (via merge-complete).

### 5. State machine audit

Audited the `GATE_FAILED → ACCUMULATING` transition path:
- **Via user abort**: Fully implemented in this slice (`abortGate()`)
- **Via hotfix squash**: `squashSliceToDev` is still a stub. When implemented (slice 266), it should check if `gate.status === 'GATE_FAILED'` and transition to `ACCUMULATING`. The mutex is already released by the regression-fail path, so hotfix squashes won't be deferred. **Note for future slice**: the squash-to-dev implementation should handle this transition.

### 6. Runbook update (docs/runbooks/RUNBOOK-BASHIR-GATE.md)

Appended "User pressed Abort after gate failure — what happens?" section before the Escalation Criteria, documenting:
- The click-through flow (Abort → hotfix slice → squash → re-gate)
- Key invariants (last_failure survives, mutex already released, no mid-flight abort)

### 7. Tests — all pass

| Test file | Tests | Result |
|---|---|---|
| `test/gate-abort.test.js` | 4 tests: GATE_FAILED→ACCUMULATING, GATE_ABORTED→ACCUMULATING, defensive mutex cleanup, disk persistence | ✅ 4/4 |
| `test/gate-fail-step-card.test.js` | 5 tests: failed_acs rendering, button presence, step variants, excerpt truncation, zero-ACs | ✅ 5/5 |
| `test/abort-from-running.test.js` | 2 tests: GATE_RUNNING throws INVALID_STATE, error includes status | ✅ 2/2 |
| `test/abort-from-idle.test.js` | 3 tests: IDLE throws, ACCUMULATING throws, state not modified | ✅ 3/3 |
| `bridge/test/gate-recovery.test.js` | 15 existing tests (Worf's gate-recovery suite) | ✅ 15/15 |

## Files changed

- `bridge/orchestrator.js` — added `abortGate()`, exported it
- `dashboard/server.js` — added `POST /api/gate/abort`, `GET /api/gate/doctor`, `GET /api/gate/register-tail`
- `dashboard/lcars-dashboard.html` — gate-fail CSS, step-card body expansion, Investigate panel, Abort flow, header pill fix
- `docs/runbooks/RUNBOOK-BASHIR-GATE.md` — appended abort flow section
- `test/gate-abort.test.js` — new
- `test/gate-fail-step-card.test.js` — new
- `test/abort-from-running.test.js` — new
- `test/abort-from-idle.test.js` — new
- `bridge/queue/271-DONE.md` — this report

## Observations

- The `regression-fail` event handler in the dashboard now triggers a `fetchBranchState()` call instead of setting static text, so the full failed_acs body renders from branch-state data.
- The `gate-abort` event handler (existing, from slice 265) calls `resetStepCards()` which is correct — after abort, step cards should hide since we're back to ACCUMULATING.
- `squashSliceToDev` is a stub; the `GATE_FAILED → ACCUMULATING` transition on hotfix-squash will need to be wired when that function is implemented.
