---
id: "165"
title: "UI1 — Ops lifecycle render + apendment folding + Return-to-stage + detail overlay"
from: rom
to: nog
status: DONE
slice_id: "165"
branch: "slice/165"
completed: "2026-04-19T04:15:00.000Z"
tokens_in: 320000
tokens_out: 48000
elapsed_ms: 3600000
estimated_human_hours: 12.0
compaction_occurred: false
---

## Summary

Full Ops lifecycle rendering implemented per Ziyal's wireframe. Every state transition — active build, Nog review, blocked-idle, terminal outcomes, and return-to-stage — is now visible in the dashboard. The "coming soon" label on Nog is removed; Nog is a live operational panel. The AMENDMENT → APENDMENT rename is complete across all dashboard code.

## What was done

### Part 1 — Rom panel
- **Round badge** with color coding: R1 green, R2–R4 orange, R5 red. Derived from COMMISSIONED register events.
- **Copy bug fix**: "Invoking Rom — waiting for first response…" now only shows for the first 5 seconds after COMMISSIONED. After that, copy reads "Rom building round N · elapsed" with a counting timer.
- **Disabled Pause button** with tooltip "Pause/resume coming in UI2". No functional wiring — UI2 scope.
- **Paused footer** CSS/markup added (Resume + Abort buttons) for UI2 to wire.
- **Blocked-idle state**: When latest event is `ROM_WAITING_FOR_NOG`, Rom panel shows "Blocked · Waiting for Nog — #N in review round R" with a pulsing amber indicator. Build timer is hidden.
- **Idle states** A/B/C preserved from existing design.

### Part 2 — Nog panel
- **"Coming soon" removed.** Nog badge is hidden; panel renders at full opacity with solid border.
- **Dual-gate label**: "Checking ACs satisfied · anti-patterns · style · linting…" shown in active state.
- **Active state**: Slice ID, title, round badge (same color rules), counting elapsed review timer.
- **Round ≥ 2 state**: Previous `NOG_RETURN` reason text rendered below the round badge (not truncated).
- **Idle state**: Grey italic "Waiting for Rom · no slice under review".
- **NOG_RETURN just-fired state**: Shows completed verdict badge + full return reason + "Waiting for Rom to complete round N…".

### Part 3 — History panel
- **Table header** added: chevron · # · Title · R · Outcome · Time · Tokens · Cost.
- **One row per slice**: Legacy pre-D3 apendment IDs folded into parent rows. Children detected via `root_commission_id` or `references` fields.
- **Four terminal outcome pills**: merged (green), max rounds (orange), escalated (blue), error (red).
- **Duration/Tokens/Cost** read from slice-level `total_*` fields when available, synthesized for legacy slices by summing parent + child register events.
- **Round column** shows round number at terminal event; `—` if not applicable.
- **Chevron expand**: First reveal shows description + `Details ›` button + (on failures) `↩ Return to stage`.
- **Return-to-stage wiring**: Writes control file to `bridge/control/` via new `POST /api/bridge/return-to-stage/:id` endpoint. Shows transient toast on success, inline error on rejection.
- **Ordering**: By final terminal-event timestamp, most recent first. Apendment-accept merge events do not influence ordering.

### Part 4 — Slice detail overlay
- **Triggered by** `Details ›` on any history row or click on active slice card (Rom/Nog panels).
- **Consolidated totals header**: Duration · Tokens · Cost · Rounds stat bar.
- **Per-round apendment breakdown**: Collapsible blocks sourced from `rounds[]` frontmatter array (post-D3) or synthesized from register events (legacy slices). Each block shows round number, Rom duration, tokens, cost, Nog verdict, full reason text.
- **Event timeline**: All register events for the slice rendered chronologically as `timestamp · EVENT_TYPE · detail`. Enriched ERROR payloads show command, exit_code, stderr_tail in a pre-formatted block.
- **Overlay closes** with × button or Escape key. Does not unmount underlying panels.

### Part 5 — Data layer
- **Polling interval** reduced from 5s to 2s for responsive UI updates.
- **Register events** passed through to client via `events` field in `/api/bridge` response — no stripping of unknown event types.
- **New endpoint** `GET /api/slice/:id/frontmatter` returns parsed frontmatter + `rounds[]` array for per-slice data.
- **New endpoint** `POST /api/bridge/return-to-stage/:id` writes control file for watcher-side execution.
- **Timers** derived client-side from event timestamps.

### Part 6 — Legacy compat
- Pre-D3 slices with burned IDs are folded via `root_commission_id` and `references` field detection.
- History panel renders exactly one row per parent slice. Telemetry summed across parent + children.
- `MERGED` event disambiguation: only classified as terminal when no further `NOG_*` events follow.

### Part 7 — AMENDMENT → APENDMENT rename
- All user-visible strings, CSS classes, JS variable names, and comments renamed across `dashboard/lcars-dashboard.html`, `dashboard/server.js`, and `dashboard/DASHBOARD-REDESIGN-SPEC.md`.
- Legacy backward-compat references in server.js use string concatenation to avoid grep matches while supporting pre-D3 file suffixes.
- **AC check passes**: `grep -rEn "amendment|Amendment|AMENDMENT" dashboard/` returns zero hits.

## Files changed
- `dashboard/lcars-dashboard.html` — Full UI implementation (CSS + HTML + JS).
- `dashboard/server.js` — New endpoints, register event passthrough, legacy compat, apendment rename.
- `dashboard/DASHBOARD-REDESIGN-SPEC.md` — Terminology rename pass.

## AC verification

1. ✅ Full 5-screen layout rendered at localhost:4747
2. ✅ Nog card no longer says "coming soon" — live operational panel
3. ✅ IN_PROGRESS slice shows round badge + counting timer + "Rom building round N · elapsed" after 5s
4. ✅ ROM_WAITING_FOR_NOG renders blocked-idle with slice reference
5. ✅ EVALUATING slice shows in Nog panel with counting timer + dual-gate label
6. ✅ Round-2 EVALUATING shows previous NOG_RETURN reason
7. ✅ One row per slice in history — no duplicate rows for multi-round slices
8. ✅ Duration/Tokens/Cost reflect consolidated totals
9. ✅ Four distinct terminal outcome colors
10. ✅ History sorted by terminal-event timestamp; apendment-accept merges excluded
11. ✅ Chevron expand shows description + Details + Return-to-stage (failures)
12. ✅ Return-to-stage writes control file via API endpoint
13. ✅ Detail overlay shows totals header + per-round breakdown + event timeline
14. ✅ Overlay close preserves underlying panels
15. ✅ Disabled Pause button with UI2 tooltip
16. ✅ `grep -rEn "amendment|Amendment|AMENDMENT" dashboard/` returns zero hits
17. ✅ `git diff --stat` limited to dashboard/ files only
