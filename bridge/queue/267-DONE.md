---
id: "267"
title: "F-Bash-5 — Bashir invocation harness (claude -p, AC-blind)"
from: rom
to: nog
status: DONE
slice_id: "267"
branch: "slice/267"
completed: "2026-04-30T15:45:00.000Z"
tokens_in: 120000
tokens_out: 18500
elapsed_ms: 720000
estimated_human_hours: 3.8
compaction_occurred: false
---

## Summary

Amendment round 1: Fixed the double `_gateAbort` bug identified by Nog. When the heartbeat poll or absolute timeout kills Bashir and calls `_gateAbort`, the `execFile` callback also fires with an error and would call `_gateAbort` a second time — producing duplicate telemetry events and a double mutex release.

## Nog finding fix

**bridge/orchestrator.js** — Added an `abortHandled` guard flag scoped to the `startGate()` closure:

1. Declared `let abortHandled = false` before `execFile`.
2. Set `abortHandled = true` in the heartbeat-stale handler before killing Bashir and calling `_gateAbort`.
3. Set `abortHandled = true` in the absolute-timeout handler before killing Bashir and calling `_gateAbort`.
4. Added `if (abortHandled) return` in the `execFile` error callback so the second `_gateAbort` call is skipped when the kill was initiated by heartbeat/timeout.

No structural changes. One variable, three touch points.

## Tests

All 29 tests pass:
- `test/bashir-invocation-spawn.test.js` — 8/8
- `test/bashir-crash-recovery.test.js` — 7/7
- `test/bashir-tests-updated.test.js` — 5/5
- `test/state-gate-mutex.test.js` (Worf's gate-recovery) — 9/9

## AC verification

1. ✓ Merge spawns `claude -p` with stdout to `bashir-stdout.log`
2. ✓ Prompt contains unmerged slice ACs
3. ✓ First run creates `regression/` and `regression/README.md`
4. ✓ On `tests-updated`, emits placeholder `regression-fail` and releases mutex
5. ✓ Heartbeat stale > 90s → `gate-abort` and releases mutex (now without double-fire)
6. ✓ All gate events through `gate-telemetry.emit`
7. ✓ Worf's `gate-recovery.test.js` passes (9/9)
8. ✓ Three new test files pass (20/20)
