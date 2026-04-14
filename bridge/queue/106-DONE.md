---
id: "106"
title: "F-02 Amendment — system health pill: two services, real data"
from: obrien
to: kira
status: DONE
brief_id: "106"
branch: "slice/106-health-pill-amendment"
completed: "2026-04-14T21:45:00.000Z"
tokens_in: 48000
tokens_out: 8500
elapsed_ms: 180000
estimated_human_hours: 1.5
compaction_occurred: false
---

## Summary

Replaced the thin F-02 health tooltip with a two-service display grounded in real data from `heartbeat.json` and `wormhole-heartbeat.json`.

## What changed

### `dashboard/server.js`
- Added `WORMHOLE_HB` path constant for `bridge/wormhole-heartbeat.json`
- Added `GET /api/health` endpoint returning both services:
  - **Watcher**: `status` (up/stale/down with 30s/60s thresholds), `heartbeatAge_s`, `currentBrief`, `elapsedSeconds`, `lastActivityAge_s`, `processedTotal`
  - **Wormhole**: `lastWriteTs`, `lastWriteTool`, `lastWritePath`, `ageSeconds` — all null if file missing

### `dashboard/lcars-dashboard.html`
- **CSS**: Added `.health-pill.degraded` state (amber), monospace tooltip styling with dot indicators, detail lines, separator
- **HTML**: Tooltip content now rendered dynamically (was static placeholder)
- **JS**: New `updateHealthPill()` function fetches `/api/health` and renders:
  - Pill colour: green (up < 30s), amber (stale 30–60s), red (down > 60s)
  - Watcher row: status dot + age + build context (brief ID, elapsed, last output age) or "idle"
  - Wormhole row: "active" (< 60s), "last write Xs ago" with tool + path, or "not yet used this session"
  - Processed total at bottom
- Removed "Last poll: XX:XX" text entirely

## Success criteria verification

1. Pill colour reflects watcher health (up/stale/down) — thresholds at 30s and 60s
2. Tooltip shows watcher row with age + build context (brief ID, elapsed, last output age)
3. Tooltip shows Wormhole row with last write age + tool + path, or "not yet used this session"
4. Processed total shown at bottom of tooltip
5. Wormhole absence (missing file) returns null fields and shows "not yet used" — does NOT trigger degraded/offline
6. "Last poll" text is gone
7. Committed on `slice/106-health-pill-amendment`
