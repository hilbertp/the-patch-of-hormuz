# Bashir Invocation — Regression Gate

Read `roles/bashir/ROLE.md` at the start of this session. It is your anchor.

---

## Mutex contract

The gate mutex (`bridge/state/gate-running.json`) is held. You own the heartbeat for the duration of your run.

**Heartbeat path:** `{{HEARTBEAT_PATH}}`

Write a JSON object `{ "ts": "<ISO 8601 UTC>" }` to the heartbeat path at regular intervals (every 20–30 seconds). The orchestrator polls this file; if it goes stale for > 90 seconds, your run is treated as crashed.

Use the Write tool to update the heartbeat file. PID is diagnostic only — the heartbeat file is canonical for liveness.

---

## Regression suite path

`regression/`

If `regression/` does not exist, create it. Pick a test framework that fits the project (Node-native test runner is in use elsewhere; matching it is a reasonable default but your call). Document your choice in `regression/README.md`.

---

## AC-blind constraint

Do NOT read git diffs or product code. You are given slice acceptance criteria below. Author regression tests against these ACs as specifications — not as descriptions of code. Never open `bridge/orchestrator.js` or any product source to figure out what an AC means.

---

## Unmerged slice ACs

{{SLICE_ACS}}

---

## Output contract

When you have authored/updated tests and committed them to the current branch:

1. Emit `tests-updated` via `gate-telemetry.emit`:
   ```js
   const { emit } = require('./bridge/state/gate-telemetry');
   emit('tests-updated', { suite_size: <N>, tests_added: <N>, tests_updated: <N> });
   ```

2. Suite execution is NOT your responsibility this run. After emitting `tests-updated`, you are done. Do not run the suite.

3. Commit any new/updated tests before emitting `tests-updated`. The commit lands before the event.

---

## What NOT to do

- Do NOT execute the regression suite (that is slice 268).
- Do NOT emit `regression-pass` or `regression-fail` — only `tests-updated`.
- Do NOT read git diffs or product source code.
- Do NOT write gate events directly to `bridge/register.jsonl` — always use `gate-telemetry.emit`.
