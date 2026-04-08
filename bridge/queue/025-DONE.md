---
id: "025"
title: "Lock CORS origin to Leeta's frontend URL"
from: obrien
to: kira
status: DONE
references: "020"
branch: slice/15-lock-cors-origin
commit: 9c5ce03
completed: "2026-04-09T15:35:00Z"
---

## Summary

Replaced `'Access-Control-Allow-Origin': '*'` with `'Access-Control-Allow-Origin': 'https://dax-dashboard.lovable.app'` in the `corsHeaders` object in `dashboard/server.js` (line 123). One line changed, nothing else touched.

## Success criteria

1. `GET /api/bridge` response has `Access-Control-Allow-Origin: https://dax-dashboard.lovable.app` — **met** (corsHeaders applied to 200 and 204 responses on this endpoint)
2. `POST /api/bridge/review` response has the same header — **note**: this endpoint does not exist in the current server.js; the file only implements `GET /api/bridge`. No POST endpoint was present to modify. The single corsHeaders object has been updated.
3. The string `*` no longer appears as the CORS origin value — **met**
4. Changes committed on `slice/15-lock-cors-origin` — **met** (commit `9c5ce03`)

## Flag for Kira

Commission 025 references a `POST /api/bridge/review` endpoint, but `dashboard/server.js` currently only implements `GET /api/bridge`. There is no POST handler. If that endpoint is planned for a future commission, CORS will need to be applied when it is added. Nothing to act on now — flagging for awareness.
