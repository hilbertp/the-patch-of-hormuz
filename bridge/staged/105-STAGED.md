---
id: "105"
title: "F-10 Ops Center — Nog active state in Post-Build Pipeline panel"
goal: "While Nog reviews a slice, the Post-Build Pipeline panel shows which slice, which round, and elapsed time — mirroring how Active Build shows O'Brien."
from: obrien
to: kira
priority: normal
created: "2026-04-15T05:30:00.000Z"
status: STAGED
branch: "slice/105-nog-active-panel"
completed: "2026-04-15T05:30:00.000Z"
estimated_human_hours: 1.0
---

## Summary

Implemented Nog's live active state in the Post-Build Pipeline panel. The panel now unmocks the Nog lane when Nog is running a code review, showing the slice ID + title, round indicator, and a live elapsed timer. When Nog is idle the lane reverts to the dashed/dimmed "coming soon" state. Bashir lane remains mocked throughout.

## Changes

### `bridge/watcher.js`

- In `invokeEvaluator`: writes `bridge/nog-active.json` before spawning the evaluator claude process — includes `sliceId`, `title`, `round`, `invokedAt` (ISO 8601)
- In the evaluator callback: deletes `bridge/nog-active.json` on exit (any outcome)

### `dashboard/server.js`

- Added `const NOG_ACTIVE = path.join(REPO_ROOT, 'bridge', 'nog-active.json')`
- `buildBridgeData()` reads `nog-active.json` and includes `nogActive` in the response (null if absent or unreadable)

### `dashboard/lcars-dashboard.html`

- Post-Build Pipeline panel: added `id="postbuild-panel"`, `id="nog-lane"`, `id="nog-badge"`, `id="nog-lane-desc"`, `id="nog-active-info"`
- `updateNogLane(nogActive)`: called from `fetchBridge`; when active — removes dashed border/opacity, adds `.nog-lane-active` class, renders slice identity, round, and live elapsed timer; when null — reverts to mocked state
- New CSS: `.nog-lane-active`, `.postbuild-lane-active-info`, `.postbuild-lane-slice-title`, `.postbuild-lane-round`, `.postbuild-lane-timer-row`, `.postbuild-lane-elapsed-val`
- Live elapsed timer ticks every 1s from `invokedAt`, same style as Active Build timer

### `.gitignore`

- Added `bridge/nog-active.json`

## Commit

`86fae9c` — feat(105/server/dashboard): Nog active state, history pagination, /content+/unaccept routes
