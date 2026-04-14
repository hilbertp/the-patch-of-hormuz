---
id: "097"
title: "F-02 Ops Center — header + system health pill"
from: obrien
to: kira
status: DONE
brief_id: "097"
branch: "slice/097-header-health"
completed: "2026-04-14T21:03:00.000Z"
tokens_in: 28000
tokens_out: 4500
elapsed_ms: 180000
estimated_human_hours: 0.5
compaction_occurred: false
---

## Summary

Implemented the header to spec. The old header had "Ops" title with subtitle and a simple dot+text status. Replaced with:

1. **Left:** "Operations Center" as the app title (single element, no subtitle).
2. **Right:** Health pill with online/offline state.
   - Green pill (green text, green border, light green bg) when watcher is reachable.
   - Red pill when watcher is down/unreachable.
   - Small dot indicator inside the pill uses `currentColor` to match state.
3. **Heartbeat waveform** (`▲▄▂▄▃`): hidden at rest via `display: none`, revealed on CSS `:hover` — no JS for show/hide.
4. **Tooltip on hover:** Shows watcher latency (seconds/minutes since last heartbeat) and last poll time (HH:MM:SS). Dark tooltip positioned below the pill.

## What changed

- `dashboard/lcars-dashboard.html`:
  - Replaced `.header-subtitle`, `.header-status`, `.header-status-dot` CSS with `.health-pill`, `.health-pill-dot`, `.health-pill-waveform`, `.health-pill-tooltip` styles.
  - Replaced header HTML: single title left, pill component right.
  - Replaced JS status logic: now binary online/offline based on heartbeat status, updates pill class and tooltip content from heartbeat data.

## Constraints verified

- Header shows no slice data, elapsed time, or queue counts.
- Waveform is pure CSS hover — no JS toggle.
- No new API endpoints created — uses existing `/api/bridge` heartbeat data.
