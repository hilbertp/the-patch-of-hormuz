---
id: "257"
title: "F-W-Bash-A1 — Bashir-gate runbook + state-doctor (re-stage after rate-limit)"
from: rom
to: nog
status: DONE
slice_id: "257"
branch: "slice/257"
completed: "2026-04-28T19:10:00.000Z"
tokens_in: 38000
tokens_out: 12000
elapsed_ms: 1200000
estimated_human_hours: 3.5
compaction_occurred: false
---

## Summary

Authored the Bashir-gate incident runbook and implemented the read-only `state-doctor.js` CLI. All acceptance criteria met.

## Deliverables

### 1. Runbook — `docs/obrien/RUNBOOK-BASHIR-GATE.md`

Five sections as specified:
- **Quick reference** — one-pager with key files and common fixes
- **State files map** — table of all state files, their writers, purpose, format
- **Failure-mode catalog** — 12 entries (F1–F12), each with trigger, detection, recovery procedure (exact commands), and post-recovery verification
- **Escalation criteria** — 6 conditions that warrant waking Philipp
- **Hand-off-to-Worf checklist** — 9-item checklist for incident handoff

### 2. State Doctor — `bridge/state-doctor.js`

Read-only CLI (324 LOC). Reads state files and prints unified text view with sections: Orchestrator, Bashir, Gate, Pause Flag, Recent Events, Anomalies.

Anomaly detection covers:
- `mutex-no-heartbeat` — mutex present but no heartbeat file
- `mutex-heartbeat-stale` — mutex present but heartbeat older than 120s
- `gate-running-no-mutex` — branch-state says GATE_RUNNING but no mutex file
- `main-tip-mismatch` — branch-state tip_sha differs from `git rev-parse main`
- `pause-flag-present` — pipeline pause flag is set

Handles missing files gracefully (prints "(absent)"). Only subprocess: `git rev-parse` for drift detection. No writes, no git mutations.

### 3. Tests — `test/state-doctor.test.js`

10 tests using synthetic state objects:
1. Happy-path renders all 6 sections
2. Anomaly: mutex present, no heartbeat
3. Anomaly: mutex present, heartbeat stale
4. Anomaly: gate RUNNING but no mutex
5. Anomaly: main tip mismatch
6. Anomaly: pause flag present
7. Missing files render "(absent)" without crash
8. CLI exits 0 when run directly
9. No anomalies in clean state
10. Multiple anomalies fire simultaneously

All 10 passing.

## Failure modes catalogued

12 failure modes (F1–F12) covering: mutex orphans, corrupt state files, gate/mutex drift, merge conflicts, lock failures, runaway processes, deferred-slice recovery, dev/main divergence, force-push detection, unparseable mutex, and deliberate pause.

## Observability Gaps for W-Bash-C

The following gaps were identified while authoring the runbook — events/states the orchestrator does not yet emit or expose, which W-Bash-C should absorb:

1. **`gate-start` event**: The runbook assumes `register.jsonl` records when a gate run begins. The orchestrator must emit this event with `slice_id`, `branch`, and `started_at`.

2. **`gate-pass` / `gate-fail` events**: The runbook assumes gate outcome events are logged. Must include `slice_id`, `duration_ms`, and for failures, a `reason` field.

3. **`gate-abort` event**: Manual or automatic abort must be logged to register.jsonl.

4. **`gate-timeout` event**: If Bashir exceeds its timeout, this should be a distinct event (not just gate-fail with reason=timeout).

5. **`recovery-scan` event**: When the orchestrator runs its recovery scan on restart, it should log what it found and what it corrected.

6. **Heartbeat staleness threshold**: State-doctor hardcodes 120s. The orchestrator's own staleness detection (if any) should use the same threshold or expose it as config. Currently no config surface for this.

7. **Gate elapsed time**: `branch-state.json` gate section should include `started_at` so state-doctor can compute elapsed time without also reading the mutex file.

8. **Deferred slice list**: State-doctor currently has no way to enumerate deferred slices. The orchestrator should expose deferred-slice metadata in `branch-state.json` or a separate file.

9. **Lock state detection**: F6 (main-lock stuck) cannot be detected by state-doctor because it would require checking filesystem permissions, which is outside its read-only contract. The orchestrator could emit a `lock-engaged`/`lock-released` event pair.

10. **Force-push detection event**: Currently state-doctor can detect tip drift, but the orchestrator itself should check on startup and emit an event if detected.

## Files changed

- `docs/obrien/RUNBOOK-BASHIR-GATE.md` (new) — runbook
- `bridge/state-doctor.js` (new, 324 LOC) — CLI
- `test/state-doctor.test.js` (new, 250 LOC) — tests
- `bridge/queue/257-DONE.md` (new) — this report

## AC Checklist

- [x] AC0: Skeleton DONE first commit
- [x] AC1: Runbook has all 5 sections
- [x] AC2: F1–F12 each with trigger, detection, recovery, verification
- [x] AC3: state-doctor.js runs, exits 0, prints unified view
- [x] AC4: Anomalies section flags all 5 required drift cases
- [x] AC5: Read-only (no writes, no git mutations, only git rev-parse)
- [x] AC6: Missing files handled gracefully
- [x] AC7: Tests cover happy path, each anomaly, missing files
- [x] AC8: 324 LOC (under 400, excluding tests and runbook)
- [x] AC9: No changes outside permitted paths
- [x] AC10: Observability gaps listed above (10 items)
