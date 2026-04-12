---
id: "021"
title: "Register-wired dashboard API"
goal: "The dashboard API will return real commission history, duration, and token costs from register.jsonl instead of just queue file state."
from: kira
to: obrien
priority: high
created: "2026-04-09T13:30:00Z"
references: "020"
timeout_min: null
---

## Objective

This is Kira, your delivery coordinator. Enrich `GET /api/bridge` so it returns real commission history, durations, and token economics from `bridge/register.jsonl` — not just what the queue directory currently shows.

The Leeta frontend needs this data to populate the "Recently Finished" panel, show elapsed durations, and eventually display token costs. Right now the API only reads queue filenames and heartbeat — it has no historical context.

## Context

**Current state:** `dashboard/server.js` reads queue files from `bridge/queue/` and `bridge/heartbeat.json`. The response shape is `{ heartbeat, queue, commissions }`. See the current `server.js` for the exact code.

**Data source to add:** `bridge/register.jsonl` — one JSON object per line. Each commission produces at least two events:
- `COMMISSIONED` event: `{ ts, id, event: "COMMISSIONED", title, goal, body }`
- `DONE` event: `{ ts, id, event: "DONE", durationMs, tokensIn, tokensOut, costUsd }`

Some commissions also have `ERROR` events.

**What the frontend needs:**
1. A `recent` array of the last 10 completed commissions with: id, title, outcome (DONE/ERROR), durationMs, tokensIn, tokensOut, costUsd, completedAt
2. The `commissions` array enriched with `goal` field (from register COMMISSIONED events or from queue file frontmatter)
3. Total economics: aggregate tokensIn, tokensOut, costUsd across all commissions

## Tasks

1. In `dashboard/server.js`, add a function `readRegister()` that reads `bridge/register.jsonl`, parses each line as JSON, and returns an array of events. Handle missing file gracefully (return empty array).

2. In `buildBridgeData()`, call `readRegister()` and build:
   - A `recent` array: the last 10 commissions that have a DONE or ERROR event, each with `{ id, title, outcome, durationMs, tokensIn, tokensOut, costUsd, completedAt }`. Sort most-recent-first by `completedAt`.
   - An `economics` object: `{ totalTokensIn, totalTokensOut, totalCostUsd, totalCommissions }` — summed across all DONE events in the register.

3. Add `recent` and `economics` to the API response. New shape:
   ```json
   {
     "heartbeat": { ... },
     "queue": { ... },
     "commissions": [ ... ],
     "recent": [ ... ],
     "economics": { ... }
   }
   ```

4. Enrich each commission in the `commissions` array with a `goal` field. Source: first check the register COMMISSIONED event for that ID, then fall back to the queue file's frontmatter `goal` field.

5. Commit all changes on branch `slice/12-register-api`.

## Constraints

- Only modify `dashboard/server.js`.
- Do not change or remove any existing fields in the response — only add new ones.
- Do not add npm dependencies. Use Node built-ins only.
- `register.jsonl` is append-only and may be large. Read it synchronously on each request for now (same pattern as heartbeat). Optimization can come later.
- Do not modify `register.jsonl` — it is read-only from the server's perspective.

## Success criteria

1. `GET /api/bridge` response includes a `recent` array with the last 10 completed commissions.
2. Each `recent` entry has: `id`, `title`, `outcome`, `durationMs`, `completedAt`. Token fields present (may be null).
3. `GET /api/bridge` response includes an `economics` object with totals.
4. Each commission in `commissions` array has a `goal` field (string or null).
5. Missing or empty `register.jsonl` doesn't crash the server — returns empty `recent` and zero `economics`.
6. All existing response fields unchanged.
7. All changes committed on branch `slice/12-register-api`.
