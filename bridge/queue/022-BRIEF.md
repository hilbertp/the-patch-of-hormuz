---
id: "022"
title: "REVIEWED event in register + review state wiring"
goal: "The register will track when Kira evaluates a commission, and the dashboard API will expose review status per commission."
from: kira
to: obrien
priority: normal
created: "2026-04-09T13:35:00Z"
references: "021"
timeout_min: null
---

## Objective

This is Kira, your delivery coordinator. Add a `REVIEWED` event type to the register lifecycle and wire review state into the dashboard API. Currently the register tracks COMMISSIONED and DONE — but not when Kira evaluates the result. The dashboard needs to show "waiting for review", "in review", and "accepted" states.

## Context

**Register events today:** `COMMISSIONED` → `DONE` (or `ERROR`). No record of Kira's evaluation.

**What's missing:** After O'Brien writes a DONE report, Kira's commission watcher evaluates it and produces a verdict (ACCEPTED or AMENDMENT REQUIRED). That verdict is not logged to `register.jsonl`, so the dashboard can't distinguish "done but not reviewed" from "reviewed and accepted."

**The kira-commission-watch task** (Cowork scheduled task, `*/3 * * * *`) is what evaluates reports. It currently reads the DONE file, checks ACs, and reports to the user — but writes nothing to the register.

## Tasks

1. Add a `writeRegisterEvent(event)` function to `dashboard/server.js` that appends a single JSON line to `bridge/register.jsonl`. The function takes an object, adds a `ts` field (ISO 8601 UTC), and appends it as one line.

2. Add a new API endpoint `POST /api/bridge/review` that accepts:
   ```json
   {
     "id": "021",
     "verdict": "ACCEPTED",
     "notes": "All 7 ACs met."
   }
   ```
   This endpoint writes a REVIEWED event to the register:
   ```json
   { "ts": "...", "id": "021", "event": "REVIEWED", "verdict": "ACCEPTED", "notes": "All 7 ACs met." }
   ```
   Return 201 on success. Validate that `id` and `verdict` are present (400 if missing). Valid verdicts: `ACCEPTED`, `AMENDMENT_REQUIRED`.

3. Add CORS headers to the new POST endpoint (same as GET).

4. In the `recent` array (added in commission 021), enrich each entry with a `reviewStatus` field:
   - Has a REVIEWED event with verdict ACCEPTED → `"accepted"`
   - Has a REVIEWED event with verdict AMENDMENT_REQUIRED → `"amendment_required"`
   - Has a DONE event but no REVIEWED event → `"waiting_for_review"`
   - No DONE event → `null`

5. Commit all changes on branch `slice/13-reviewed-event`.

## Constraints

- Only modify `dashboard/server.js`.
- The POST endpoint is intentionally unauthenticated — this is a local tool.
- Do not add npm dependencies.
- The REVIEWED event must be appended to the same `register.jsonl` that COMMISSIONED and DONE events live in.
- Do not modify existing register events — append only.

## Success criteria

1. `POST /api/bridge/review` accepts `{ id, verdict, notes }` and returns 201.
2. The POST writes a REVIEWED event to `bridge/register.jsonl` with correct schema.
3. POST returns 400 if `id` or `verdict` is missing, or if `verdict` is not a valid value.
4. Each entry in the `recent` array includes a `reviewStatus` field derived from register events.
5. CORS headers present on the POST endpoint (including OPTIONS preflight).
6. All existing endpoints and response shapes unchanged.
7. All changes committed on branch `slice/13-reviewed-event`.
