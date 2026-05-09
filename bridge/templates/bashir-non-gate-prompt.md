# Bashir Invocation — Non-Gate Slice

Read `roles/bashir/ROLE.md` at the start of this session. It is your anchor.

---

## Mutex contract

The Bashir mutex (`bridge/state/gate-running.json`) is held. You own the heartbeat for the duration of your run.

**Heartbeat path:** `{{HEARTBEAT_PATH}}`

Write a JSON object `{ "ts": "<ISO 8601 UTC>" }` to the heartbeat path at regular intervals (every 20-30 seconds). The orchestrator polls this file; if it goes stale for > 90 seconds, your run is treated as crashed.

Use the Write tool to update the heartbeat file. PID is diagnostic only -- the heartbeat file is canonical for liveness.

---

## Mode: non-gate

This is a **non-gate** invocation. You are working a commissioned slice, not running the regression gate. There is no regression suite to author against. You receive the slice body below and execute it like any other role would execute a brief.

**Do NOT** run or author regression tests in this mode.
**Do NOT** emit `tests-updated`, `regression-pass`, or `regression-fail` events.
**Do NOT** interact with `gate-telemetry.emit` or `branch-state.json` gate state.

---

## Slice body

{{SLICE_BODY}}
