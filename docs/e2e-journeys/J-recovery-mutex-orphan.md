---
id: J-recovery-mutex-orphan
category: recovery
status: draft
last_reviewed: 2026-05-08
---

# Recover from orphaned gate mutex (Bashir crash mid-gate)

## What the user is trying to accomplish

Bashir crashes or hangs while the gate is running, leaving the mutex file `bridge/state/gate-running.json` behind. The orchestrator detects the orphan via stale heartbeat, aborts the gate, cleans up, and allows the next merge attempt.

## Preconditions

- Gate is running (gate-running.json exists with valid `started_ts` and `bashir_heartbeat_path`)
- Bashir's heartbeat file exists at the path recorded in the mutex (canonically `bridge/state/bashir-heartbeat.json`)
- Bashir process is dead (crashed, killed, hung) and not updating the heartbeat
- Orchestrator is still running

## Steps

1. Bashir is running the regression suite when an internal error causes it to crash (e.g., out of memory, disk full, unhandled exception)
2. Bashir's process exits without emitting `regression-fail` or `regression-pass`
3. The mutex file `bridge/state/gate-running.json` persists
4. The heartbeat file `bridge/state/bashir-heartbeat.json` stops being updated
5. The orchestrator's next dispatch cycle checks the heartbeat ts and compares it to `now - orphan_threshold` (default: 3× heartbeat interval, ~45–90s)
6. The heartbeat is stale; the orchestrator concludes Bashir is dead
7. The orchestrator emits `gate-abort` event with reason `orchestrator_detected_bashir_orphan` and a recorded heartbeat age
8. The orchestrator deletes `bridge/state/gate-running.json`
9. The orchestrator processes any deferred ACCEPTED slices that were queued during the gate
10. The orchestrator updates `branch-state.json` gate section to `GATE_ABORTED`
11. The dashboard receives the `gate-abort` event and closes the progress widget
12. The header health pill reverts to "ONLINE"
13. The Merge button is re-enabled and shows state "Aborted — merge when ready"

## Expected outcomes

- Mutex file is deleted by the orchestrator (not manually)
- Heartbeat file is preserved (for post-mortem analysis)
- `branch-state.json` gate.status is `GATE_ABORTED`
- Register contains a `gate-abort` event with `reason: orchestrator_detected_bashir_orphan` and `heartbeat_age_seconds: 125`
- Deferred ACCEPTED slices squash to dev
- Dashboard shows the abort event in some form (e.g., a notification toast or status message)
- The gate state reverts to allow manual retry
- Bashir's code is not re-invoked; the abort is fully orchestrator-driven

## Known failure modes

- **Heartbeat check is too lenient.** Bashir is actually still running but slow, and the heartbeat is legitimately stale (e.g., Bashir is in a 2-minute compilation loop). *Recovery:* Increase the orphan threshold. Acceptable cost — a gate failure is recoverable; a false-positive abort destroys test results.
- **Heartbeat file is missing entirely.** The orchestrator can't find the ts to compare. *Recovery:* The orchestrator should default to the PID-based secondary signal (check if the PID is still alive); if the PID is dead, abort. If the PID is alive, assume Bashir is still working and don't abort.
- **Orchestrator itself crashes while detecting the orphan.** The orchestrator dies mid-abort sequence, before deleting the mutex. *Recovery:* On orchestrator restart, the recovery scan re-derives branch state and reinitializes gate to `IDLE`, releasing the mutex.
- **User manually deletes gate-running.json while Bashir is still alive.** Bashir later completes and emits `regression-pass`, but the orchestrator ignores it (no active gate). *Recovery:* This is a manual intervention error; the operator should not delete the mutex by hand. If it happens, restart the orchestrator to reinitialize.

## Sources

- `docs/architecture/BRANCHING-FOR-BASHIR-GATE-ADR.md` — §4 mutex liveness, heartbeat-primary signal, orphan recovery
- `docs/runbooks/RUNBOOK-BASHIR-GATE.md` — §Failure-Mode-Catalog F1 and F2 (mutex orphaned scenarios)
- `bridge/orchestrator.js` — heartbeat check logic and gate-abort emission
- `bridge/state-doctor.js` — diagnostic CLI for detecting orphan state

## Open questions

- What is the orchestrator's decision logic if Bashir is slow but alive? Does the orchestrator wait for a maximum total gate duration (e.g., "if gate has been running for >30min, abort"), or only check heartbeat freshness?
- When the orchestrator detects the orphan, does it send a signal (e.g., SIGTERM) to the Bashir process before deleting the mutex, or does it trust that Bashir is already dead?
- Is the heartbeat file itself cleaned up after the gate completes (success or failure), or does it persist forever for forensics?
