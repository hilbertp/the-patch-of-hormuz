---
id: "026"
title: "Relay-invoked commission evaluator"
from: obrien
to: kira
status: DONE
references: null
branch: slice/26-evaluator
commit: d4ddd40
completed: "2026-04-09T17:00:00Z"
---

## Summary

Implemented the full autonomous evaluation loop inside `bridge/watcher.js` and added `POST /api/bridge/review` to `dashboard/server.js`. The relay now evaluates every DONE report without Cowork involvement.

## What was built

### `bridge/watcher.js`

**`poll()` extension** — After checking for PENDINGs (unchanged, priority 1), the poll loop now scans for DONE files (priority 2). For each DONE file:
- If `type: merge` in COMMISSION frontmatter → auto-accepts (no claude -p), registers ACCEPTED, calls review API.
- If already reviewed (REVIEWED/ACCEPTED/STUCK event in register) → skips.
- Otherwise → renames DONE → EVALUATING, sets `processing = true`, sets heartbeat to `evaluating`, invokes `invokeEvaluator()`.

**`invokeEvaluator(id)`** — Mirrors `invokeOBrien()`:
- Reads `{id}-COMMISSION.md` (original ACs) and `{id}-EVALUATING.md` (O'Brien's report).
- Extracts branch name from DONE frontmatter; derives root_commission_id and cycle count from register.
- Constructs evaluator prompt per Dax's ADR Section 3 (Kira persona, full commission + DONE, cycle/branch context).
- Calls `claude -p --output-format json`; parses JSON verdict from response.
- Falls back to re-queuing EVALUATING → DONE if parsing fails.
- STUCK check: if `AMENDMENT_NEEDED` and `cycle >= 5`, routes to `handleStuck`.

**`handleAccepted()`** — Registers ACCEPTED event, renames EVALUATING → ACCEPTED, writes merge commission `{nextId}-PENDING.md` with `type: merge`, `source_commission_id`, `branch`. Calls review API.

**`handleAmendment()`** — Registers REVIEWED event with verdict, failed_criteria, cycle, root_commission_id. Renames EVALUATING → REVIEWED. Writes amendment commission `{nextId}-PENDING.md` with `type: amendment`, `root_commission_id`, `amendment_cycle`, `branch`, original ACs + fix instructions. Calls review API.

**`handleStuck()`** — Registers STUCK event, renames EVALUATING → STUCK, no new PENDING. Calls review API.

**`crashRecovery()` extension** — Now also scans for `-EVALUATING.md` orphans at startup and renames them back to DONE for re-evaluation on next poll.

**`callReviewAPI()`** — HTTP helper that POSTs `{ id, verdict, reason }` to `http://127.0.0.1:4747/api/bridge/review`. Failures logged but non-fatal.

**`countReviewedCycles(rootId)`** — Reads register.jsonl and counts REVIEWED events for a root commission ID.

**`hasReviewEvent(id)`** — Returns true if register has a REVIEWED/ACCEPTED/STUCK event for the given ID.

### `dashboard/server.js`

**`POST /api/bridge/review`** — New endpoint accepting `{ id, verdict, reason }`. Returns 201 on success. Returns 400 if id/verdict missing or verdict not in `[ACCEPTED, AMENDMENT_NEEDED, STUCK]`. CORS headers match the GET endpoint (origin: `https://dax-dashboard.lovable.app`). Appends a `REVIEW_RECEIVED` event to `bridge/register.jsonl`.

Also extracted CORS origin into a `CORS_ORIGIN` constant to avoid drift between GET and POST handlers.

## Notes / flags for Kira

1. **025-DONE evaluation pending**: Commission 025 (currently in DONE state) will be evaluated on the next poll cycle once the watcher is restarted on this branch. The result (ACCEPTED or AMENDMENT_NEEDED) will appear automatically in the queue.

2. **Response parsing**: The evaluator prompt asks for raw JSON. Claude's `--output-format json` wrapper puts the response in a `result` field. The parser tries `claudeOutput.result`, then `claudeOutput.content`, then falls back to regex-extracting JSON from the raw stdout. This is robust to minor formatting variation.

3. **`POST /api/bridge/review` was not on main**: Commission 022 built this on `slice/13-reviewed-event` (unmerged). This commission re-implements it on `slice/26-evaluator` with the correct valid verdicts for the evaluator (ACCEPTED, AMENDMENT_NEEDED, STUCK instead of ACCEPTED, AMENDMENT_REQUIRED).

4. **Branch name dependency**: If O'Brien writes a DONE report without a `branch:` frontmatter field, the amendment/merge commission will have an empty branch. The evaluator prompt includes this as a convention requirement but cannot enforce it for past reports.

## Success criteria

- [x] `poll()` scans DONE files after PENDINGs, handles merge auto-accept
- [x] `invokeEvaluator()` reads COMMISSION + EVALUATING, constructs prompt, calls `claude -p`, parses JSON response
- [x] ACCEPTED verdict: register event written, file renamed, merge commission created, API call made
- [x] AMENDMENT_NEEDED verdict: register event written, file renamed, amendment commission created with root_commission_id, cycle count, branch, ACs + fix instructions, API call made
- [x] STUCK verdict: register event written, file renamed, no new PENDING, API call made
- [x] Merge commissions skip evaluation entirely (auto-accept on DONE)
- [x] Branch name flows from DONE → amendment → merge
- [x] Amendment cycle count derived from register REVIEWED events
- [x] Crash recovery extended to EVALUATING orphans
- [x] Heartbeat reflects `evaluating` status during run, idle after
- [x] `POST /api/bridge/review` added to server.js with CORS headers
- [x] All register events use correct event types via existing `registerEvent()`
- [x] All new commissions have valid frontmatter per template schema
