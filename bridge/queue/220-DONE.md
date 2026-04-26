---
id: "220"
title: "F-WP — Power: dashboard caching + 5s browser poll + orchestrator adaptive idle"
from: rom
to: nog
status: DONE
slice_id: "220"
branch: "slice/220"
completed: "2026-04-26T11:28:00.000Z"
tokens_in: 52000
tokens_out: 8500
elapsed_ms: 780000
estimated_human_hours: 2.5
compaction_occurred: false
---

## Summary

Cut dashboard per-request CPU cost by adding mtime-based caching, reduced browser poll rate 2.5x, and added orchestrator adaptive idle poll with heartbeat hash-dedup.

## Changes

### Dashboard server (`dashboard/server.js`)

- **`getCachedFile(path, parser)`** — checks `fs.statSync().mtimeMs` before re-parsing. If mtime unchanged, returns cached value. On change, re-parses and updates cache.
- **`getCachedDir(dirPath, filter, parser)`** — caches directory listing (invalidated by dir mtime) + per-file parsed content (invalidated by per-file mtime). Only re-parses changed files.
- **`readRegister()`** — now uses `getCachedFile` for register.jsonl. Eliminates per-request 27MB parse.
- **`buildBridgeData()`** — heartbeat read and queue dir scan routed through cache.
- **`buildCostsData()`** — register.jsonl read routed through cache.
- **`/api/health`** — heartbeat read routed through cache.
- Exported `getCachedFile`, `getCachedDir`, `_cache` for testability.

### Browser frontend (`dashboard/lcars-dashboard.html`)

- `setInterval(fetchBridge, 2000)` → `5000`
- `setInterval(fetchCombinedQueue, 2000)` → `5000`

### Orchestrator (`bridge/orchestrator.js`)

- **Adaptive idle poll:** `IDLE_POLL_MS = 30000`, `IDLE_THRESHOLD = 24` (24 × 5s = 2min). After 24 consecutive idle ticks, poll interval increases to 30s. Resets to `config.pollIntervalMs` (5s) when DONE or QUEUED files appear.
- **`schedulePoll()`** — replaces fixed `setInterval(poll, ...)` with `clearInterval`/`setInterval` pattern that respects `currentPollMs`.
- **Heartbeat hash-dedup:** `writeHeartbeat()` hashes status/current_slice/elapsed/queue fields (excluding `ts`). Skips `fs.writeFileSync` when hash matches `_lastHeartbeatHash`.

### lsof short-circuit (already present)

`sweepStaleResources()` in `bridge/git-finalizer.js` already gates `isGitProcessAlive()` behind `if (lockExists())`. When `.git/index.lock` is absent, no lsof subprocess is spawned. No change needed.

## Test results

10/10 regression tests pass (`test/power-cache.test.js`):

- A. Cache returns correct result on first read
- B. Cache returns cached result when mtime unchanged (no re-parse)
- C. Cache re-parses on mtime change
- D. getCachedDir returns per-file parsed content
- E. getCachedDir re-parses only changed files
- F. Browser auto-refresh intervals are 5000ms
- G. Orchestrator has adaptive idle poll constants
- H. Orchestrator resets poll interval on activity
- I. writeHeartbeat has hash-dedup logic
- J. sweepStaleResources skips lsof when index.lock absent

## Qualitative before/after

Before: every browser poll triggers a full 27MB register.jsonl parse + 348 file stats. At 2s interval, that's ~1 full parse per second sustained. After: register parse happens once and is cached until mtime changes (only on new appends). Queue dir scan re-stats files only when the directory mtime changes. Browser polls at 5s instead of 2s. Net: CPU per open browser tab drops from ~constant-27MB-parse to near-zero when no files change. Orchestrator drops from 5s to 30s poll when idle for 2+ minutes, further reducing background CPU.

## Diff stats

- `dashboard/server.js`: +132/-14 (cache helpers + wiring)
- `dashboard/lcars-dashboard.html`: +2/-2 (interval change)
- `bridge/orchestrator.js`: +44/-2 (adaptive poll + heartbeat dedup)
- `test/power-cache.test.js`: +224 (new test file)
- Total excluding tests: 178 insertions, 46 deletions = net 132 LOC (under 250 cap)
