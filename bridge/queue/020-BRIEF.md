---
id: "020"
title: "CORS + configurable HOST on dashboard server"
goal: "The dashboard API will be callable from an external frontend hosted on a different origin."
from: kira
to: obrien
priority: high
created: "2026-04-09T12:30:00Z"
references: null
timeout_min: null
---

## Objective

This is Kira, your delivery coordinator. Add CORS headers and make the server HOST configurable in `dashboard/server.js` so that an external frontend (hosted on Lovable's domain) can call `GET /api/bridge` cross-origin.

## Context

We are splitting the dashboard into two repos. The backend stays in this repo. The frontend will be a separate React app hosted on Lovable's domain (URL TBD). That frontend needs to call `GET /api/bridge` cross-origin.

Currently `server.js` has two problems:
1. No `Access-Control-Allow-Origin` header — browser will block cross-origin requests
2. `HOST` is hardcoded to `127.0.0.1` — only reachable from localhost

Relevant file: `dashboard/server.js`

## Tasks

1. Add CORS headers to the `/api/bridge` response. Use `Access-Control-Allow-Origin: *` for now (we will restrict to a specific origin once the frontend URL is known). Include `Access-Control-Allow-Methods: GET` and `Access-Control-Allow-Headers: Content-Type`.
2. Handle `OPTIONS` preflight requests on `/api/bridge` — respond 204 with the same CORS headers.
3. Make `HOST` configurable via environment variable `DASHBOARD_HOST`, defaulting to `0.0.0.0`. Keep `PORT` configurable via `DASHBOARD_PORT`, defaulting to `4747`.
4. Commit all changes on branch `slice/11-cors-host`.

## Constraints

- Only modify `dashboard/server.js`. Do not touch any other files.
- Do not change the response shape of `GET /api/bridge` — the JSON structure must remain identical.
- Do not add any npm dependencies. Use Node built-in `http` module only (already in use).
- Do not remove the existing `GET /` route that serves the HTML dashboard.

## Success criteria

1. `GET /api/bridge` response includes `Access-Control-Allow-Origin: *` header.
2. `OPTIONS /api/bridge` returns 204 with CORS headers.
3. Server binds to `0.0.0.0` by default (or whatever `DASHBOARD_HOST` is set to).
4. `DASHBOARD_HOST` and `DASHBOARD_PORT` environment variables are respected when set.
5. All existing functionality (serving dashboard HTML at `/`, JSON at `/api/bridge`) still works.
6. All changes committed on branch `slice/11-cors-host`.
