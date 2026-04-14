---
id: "084"
title: "Fix naked history rows: server fallback + watcher COMMISSIONED hardening"
from: obrien
to: kira
status: DONE
brief_id: "084"
branch: "slice/084-fix-naked-history-rows"
completed: "2026-04-14T18:50:00.000Z"
tokens_in: 42000
tokens_out: 3500
elapsed_ms: 180000
estimated_human_hours: 0.75
compaction_occurred: false
---

## Summary

Both fixes implemented and committed together on `slice/084-fix-naked-history-rows`.

### Task 1 — server.js fallback

Added `getTitleAndGoal(id, commissioned)` helper above `buildBridgeData()`. It first checks the `commissioned` map (existing behaviour), then falls back to reading `{id}-BRIEF.md` from `QUEUE_DIR` and parsing its frontmatter. Returns `{ title: null, goal: null }` if neither source has a value.

Applied in the `completedMap` construction where `recent` history entries are built — both `title` and `goal` fields now use the resolved values.

### Task 2 — watcher.js COMMISSIONED hardening

Added `registerCommissioned(id, extra)` function that:
1. Attempts the register write (same as `registerEvent`).
2. On failure, logs a warning and retries once immediately.
3. If the retry also fails, logs an error AND writes a prominent `⚠️ CRITICAL` line to `process.stdout` so it's visible in the watcher terminal.

Replaced the `registerEvent(id, 'COMMISSIONED', ...)` call at the pickup site with `registerCommissioned(id, ...)`. The generic `registerEvent` function is unchanged — all other call sites are unaffected.

### Task 3 — backfill verification for slice 082

- Confirmed: no COMMISSIONED event exists for ID 082 in `register.jsonl`.
- `082-BRIEF.md` exists in the queue with `title: "Strip KAL section from ruflo-benchmark-baseline"` and `goal` in frontmatter.
- With the server fallback live, `getTitleAndGoal('082', commissioned)` will read `082-BRIEF.md` and return the correct title/goal. The history row will display properly — no manual register patching needed.

## Success criteria verification

1. **Server fallback** — `getTitleAndGoal()` reads `{id}-BRIEF.md` when no COMMISSIONED event exists. Done.
2. **Slice 082 title** — 082-BRIEF.md exists with correct title; fallback will resolve it. Done.
3. **Watcher retry + alert** — `registerCommissioned()` retries once, emits stdout warning on double failure. Done.
4. **Existing rows unaffected** — `getTitleAndGoal()` checks `commissioned` map first (same as before). Done.
5. **Branch** — All changes on `slice/084-fix-naked-history-rows`. Done.
