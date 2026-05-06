---
id: "292"
title: "F-Disp-1 — FIFO dispatch via queue-order.json head consumption"
from: rom
to: nog
status: DONE
slice_id: "292"
branch: "slice/292"
completed: "2026-05-06T07:45:00.000Z"
tokens_in: 42000
tokens_out: 8500
elapsed_ms: 180000
estimated_human_hours: 1.5
compaction_occurred: false
---

## Summary

Replaced the sort-based dispatch pickup in `bridge/orchestrator.js` with strict FIFO head consumption from `queue-order.json`. The dispatcher now:

1. Reads `queue-order.json` and takes the first valid ID (head consumption, not sort-merge).
2. Removes stale IDs (entries with no matching QUEUED file) and persists the cleaned array atomically.
3. If `queue-order.json` is missing or empty but QUEUED files exist, reconstructs the order from file mtime ascending (oldest first) and persists it.

## Changes

- `bridge/orchestrator.js` — replaced the `pendingFiles` sort block (lines ~4473-4518) with FIFO head-consumption logic including stale-ID cleanup and mtime-based recovery.
- `bridge/test/dispatch-fifo.test.js` — four tests covering: FIFO order [A,B,C]→picks A; after A removed→picks B; empty queue-order recovery from mtime; stale-ID removal.

## Test results

All test suites pass:
- `dispatch-fifo.test.js`: 4/4 pass
- `gate-recovery.test.js`: 15/15 pass
- `depends-on-gate.test.js`: 10/10 pass
- `gate-flow-flag.test.js`: 6/6 pass
- `history-pill-outcomes.test.js`: 6/6 pass

## Acceptance criteria met

1. ✓ queue-order.json `["A","B","C"]` → picks A
2. ✓ After dispatching A → picks B
3. ✓ Missing/empty queue-order.json + QUEUED files → rebuilds mtime ASC, picks oldest
4. ✓ Stale entries removed, next valid ID picked
5. ✓ Four tests pass
6. ✓ No regression in gate-recovery suite
7. ✓ Only orchestrator.js + test file + DONE report changed
