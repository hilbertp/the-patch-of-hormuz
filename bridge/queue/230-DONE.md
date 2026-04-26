---
id: "230"
title: "F-WP3 — Remove heartbeat write dedup (broke liveness signal)"
from: rom
to: nog
status: DONE
slice_id: "230"
branch: "slice/230"
completed: "2026-04-26T19:30:00.000Z"
tokens_in: 18000
tokens_out: 3500
elapsed_ms: 240000
estimated_human_hours: 0.3
compaction_occurred: false
---

## Summary

Removed the hash-based heartbeat write dedup that WP (slice 220) introduced. The dedup skipped disk writes when heartbeat state was unchanged, which broke the liveness signal — the dashboard reported the orchestrator as "down" during idle periods because `heartbeat.json`'s `ts` field went stale.

## Changes

### `bridge/orchestrator.js` (−14 lines)
- Removed `const crypto = require('crypto')` import (only used by dedup)
- Removed `let _lastHeartbeatHash = null` module variable
- Removed the 10-line hash-dedup block (hash computation, comparison, early return, hash update)
- `writeHeartbeat()` now always writes to disk on every call

### `bridge/test-heartbeat-no-dedup.js` (new, 81 lines)
- Test 1: Verifies `_lastHeartbeatHash` and dedup comment are absent from source
- Test 2: Verifies two consecutive identical heartbeat writes both update the file (mtime advances, ts differs)

## Acceptance criteria

- [x] AC0: Skeleton DONE first commit
- [x] AC1: `writeHeartbeat()` writes to disk on every call regardless of state
- [x] AC2: `_lastHeartbeatHash` module variable removed
- [x] AC3: After merge + restart, heartbeat.json mtime will advance every 60s in idle
- [x] AC4: Dashboard "Orchestrator" indicator will show green/up while alive
- [x] AC5: Regression test verifies two consecutive identical-state writes both produce file writes
- [x] AC6: WP's other changes (adaptive idle poll, lsof short-circuit, dashboard caching) untouched
- [x] AC7: Diff is 14 LOC deleted (well under 20 LOC limit), excluding tests
- [x] AC8: No changes outside `bridge/orchestrator.js` and the test file
