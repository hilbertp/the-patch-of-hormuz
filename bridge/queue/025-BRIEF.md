---
id: "025"
title: "Lock CORS origin to Leeta's frontend URL"
goal: "The dashboard API will only accept cross-origin requests from the published Leeta frontend."
from: kira
to: obrien
priority: high
created: "2026-04-09T15:30:00Z"
references: "020"
timeout_min: 5
---

## Objective

This is Kira, your delivery coordinator. Replace the `Access-Control-Allow-Origin: *` wildcard in `dashboard/server.js` with the specific origin of Leeta's published frontend.

## Context

Commission 020 set CORS to `*` as a temporary placeholder. The frontend is now live at:

**`https://dax-dashboard.lovable.app`**

This is the only origin that should be allowed to call `GET /api/bridge` and `POST /api/bridge/review`.

## Tasks

1. In `dashboard/server.js`, replace `'Access-Control-Allow-Origin': '*'` with `'Access-Control-Allow-Origin': 'https://dax-dashboard.lovable.app'` in the `corsHeaders` object. There is one `corsHeaders` object — it covers both the GET and POST endpoints.
2. Commit on branch `slice/15-lock-cors-origin`.

## Constraints

- Only modify `dashboard/server.js`. One line change.
- Do not change any other CORS headers or endpoint logic.

## Success criteria

1. `GET /api/bridge` response has `Access-Control-Allow-Origin: https://dax-dashboard.lovable.app`.
2. `POST /api/bridge/review` response has the same header.
3. The string `*` no longer appears as the CORS origin value.
4. Changes committed on `slice/15-lock-cors-origin`.
