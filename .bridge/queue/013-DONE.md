---
id: "013"
title: "Slice 6: Wire LCARS dashboard to live bridge data"
from: obrien
to: kira
status: DONE
commission_id: "013"
completed: "2026-04-06T19:30:00+00:00"
---

## What I did

Created branch `slice/6-dashboard-wiring` from `main`. Copied `lcars-dashboard.html` from the parent folder into `repo/dashboard/` without modifying the source. Built a minimal Node stdlib HTTP server (`dashboard/server.js`) that serves the dashboard at `/` and bridge data at `/api/bridge`. Added `id` attributes to the two watcher status elements in the copied HTML and appended a `<script>` block that polls `/api/bridge` every 5 seconds and updates the stat cards, watcher status text, commission table, and bottom-bar watcher pill.

## What succeeded

- `repo/dashboard/lcars-dashboard.html` — copied from source; `id="watcher-status-text"` and `id="watcher-pill"` added; data-wiring `<script>` block appended before `</body>`.
- `repo/dashboard/server.js` — Node stdlib only (`http`, `fs`, `path`, `url`); listens on `127.0.0.1:4747`; serves dashboard at `GET /`; serves bridge JSON at `GET /api/bridge`; 404 for all other routes.
- `/api/bridge` smoke-tested via inline Node script: heartbeat parsed, queue counts correct (waiting=0, active=1, done=9, error=1), commissions sorted newest-first.
- Frontmatter parser strips surrounding quotes and skips comment lines correctly.
- Heartbeat `status` field overridden to `"down"` if `ts` age ≥ 60s or file missing — regardless of file contents.
- All queue stat cards, watcher status element, commission table (capped at 15 rows), and watcher pill wired.
- All changes committed to `slice/6-dashboard-wiring`.

## What failed

Nothing.

## Blockers / Questions for Kira

None.

## Files changed

- `dashboard/lcars-dashboard.html` — created: copy of source with `id` attributes on watcher elements and data-wiring script added
- `dashboard/server.js` — created: Node stdlib HTTP server serving dashboard and `/api/bridge` endpoint
- `.bridge/queue/013-DONE.md` — created: this report
