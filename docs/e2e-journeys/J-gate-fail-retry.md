---
id: J-gate-fail-retry
category: gate-merge
status: draft
last_reviewed: 2026-05-08
---

# Gate fails, Bashir flags failed AC, user commissions hotfix and retries

## What the user is trying to accomplish

Philipp presses merge; Bashir runs the tests and one fails. The failure is traced to an unmet AC from one of the slices. The gate halts, Bashir reports the failure, and O'Brien commissions a hotfix slice. Rom quickly fixes the issue, Nog approves, and Philipp retries the merge.

## Preconditions

- Merge gate is running (gate-start event emitted, tests-updated passed)
- Bashir's regression suite is executing
- One or more acceptance criteria from an unmerged slice are not met by the current state of dev
- Bashir detects the failure via a test that guards the unsatisfied AC

## Steps

1. Bashir runs the regression suite
2. One test fails: "Slice 247 AC#2: queue-reorder persists order atomically" — the test asserts order persistence but the actual order in queue-order.json differs
3. Bashir emits `regression-fail` with payload identifying the failed AC: `{ slice_id: "247", ac_index: 1, test_path: "regression/247-queue-reorder.test.js", failure_excerpt: "...expected order [1,2,3] but got [1,3,2]..." }`
4. The orchestrator receives `regression-fail` and updates `branch-state.json` gate section to `GATE_FAILED`
5. The orchestrator deletes `bridge/state/gate-running.json` (releases the deferred-squash mutex)
6. Any slices that were deferred during the gate (stuck in ACCEPTED) are now released and squash to dev
7. The dashboard's progress widget stops; step 2 card shows error (red) with failure details extracted from the event payload
8. The header health pill reverts to "ONLINE"
9. The Merge button reappears with state "enabled" (user can re-press to retry)
10. O'Brien reads the failure report and commissions a hotfix slice 248 to fix the queue-reorder atomicity issue
11. Rom picks up slice 248, reads AC#2, and identifies the bug: the orchestrator wasn't doing an atomic write via temp+rename
12. Rom fixes the code, appends DONE, and signals completion
13. Nog reviews the hotfix and accepts it
14. The orchestrator squash-merges slice 248 to dev (no gate running now, so it squashes immediately)
15. Philipp re-presses the Merge button
16. Gate runs again; all tests pass (including the previously-failed AC#2 test for slice 247)
17. Merge completes; dev and main fast-forward to the new tip

## Expected outcomes

- Register contains events in order: `gate-start`, `tests-updated`, `regression-fail`, `gate-abort` (implicit, as the gate ends in failure)
- `branch-state.json` gate.status changes from `GATE_RUNNING` → `GATE_FAILED`
- `branch-state.json` gate.last_failure is populated with the failed AC details
- dashboard progress widget shows error state with the failure excerpt
- Merge button is re-enabled and clickable
- Deferred ACCEPTED slices squash to dev after the mutex is deleted
- Hotfix slice 248 lands on dev and is included in the next merge batch
- On retry, the regression-pass event is emitted and merge completes normally
- `branch-state.json` gate.status changes from `GATE_FAILED` → `IDLE` on successful retry
- History panel shows all slices (including the hotfix) with `ACCEPTED` badges

## Known failure modes

- **Failure report is unclear.** Bashir's test name or failure_excerpt doesn't identify which AC failed. *Recovery:* O'Brien has to dig into Bashir's test and the slice body to figure out what's wrong. Consider improving Bashir's payload or test naming.
- **Deferred slices don't squash after the mutex is deleted.** The orchestrator's dispatch loop may not check for deferred slices. *Recovery:* Manually trigger a squash or restart the orchestrator to force a re-read of the ACCEPTED queue.
- **Hotfix introduces a new failure.** Rom's fix for slice 247 breaks something else. *Recovery:* Another hotfix is commissioned; the retry cycle continues. Per ADR, this is expected (hotfixes are normal slices through the pipeline).
- **Orchestrator crashes while gate-running.json is present.** The mutex becomes orphaned. *Recovery:* Startup recovery (Worf's runbook) detects stale heartbeat and aborts the gate, releasing the mutex. See J-recovery-mutex-orphan.

## Sources

- `docs/architecture/BRANCHING-FOR-BASHIR-GATE-ADR.md` — GATE_FAILED state, deferred squash, retry mechanics
- `docs/runbooks/RUNBOOK-BASHIR-GATE.md` — failure detection and reporting
- `docs/contracts/slice-format.md` — acceptance criteria format
- `.claude/roles/bashir/ROLE.md` — Bashir's bad-test diagnosis (if test is flaky, Bashir fixes it and re-runs; if code is wrong, O'Brien commissions hotfix)
- `repo/.claude/roles/obrien/inbox/HANDOFF-OPS-REDESIGN-SPEC-FROM-ZIYAL.md` — gate progress widget error state

## Open questions

- When the gate fails and Bashir reports `regression-fail`, is the report persisted in the register, or only in `branch-state.json` under `gate.last_failure`? Should the dashboard show historical failures or just the most recent?
- If O'Brien commissions multiple hotfixes in response to a single gate failure, do they all land on dev in a specific order before the retry, or is the retry timing O'Brien's decision?
- The ADR says "deferred slices drain" when the mutex is deleted — what is the drain ordering? FIFO by `accepted_ts`? By slice ID? Is the ordering observable in the dashboard?
