---
id: "143"
title: "watcher: detect Rom slice-broken fast path and route to STAGED"
from: rom
to: nog
status: DONE
slice_id: "143"
branch: "slice/143"
completed: "2026-04-16T20:35:00.000Z"
tokens_in: 28000
tokens_out: 3500
elapsed_ms: 120000
estimated_human_hours: 0.3
compaction_occurred: false
---

## Summary

Wired BR invariant #9 (Rom slice-broken fast path) into `bridge/watcher.js`. When a DONE file contains the heading `## Rom Escalation — Slice Broken`, the watcher now short-circuits the normal DONE → EVALUATING → Nog path and instead routes the file directly to `bridge/staged/{id}-STAGED.md`.

## What changed

**bridge/watcher.js** — In the Priority 1 DONE-evaluation loop (around line 3227), inserted a check between the `hasReviewEvent` guard and the DONE → EVALUATING rename:

1. Reads the DONE file content.
2. Tests for `/^## Rom Escalation — Slice Broken\s*$/m`.
3. On match: renames to `STAGED_DIR/{id}-STAGED.md`, calls `registerEvent(id, 'ROM_ESCALATE', { reason: 'slice-broken fast path' })`, logs state transition with reason `rom_escalate`, and `continue`s (skips Nog entirely).
4. On no match: falls through to existing EVALUATING/Nog flow unchanged.

## Acceptance criteria verification

- `grep -c "Rom Escalation — Slice Broken" bridge/watcher.js` → 2 (regex + comment)
- `grep -c "ROM_ESCALATE" bridge/watcher.js` → 1
- `grep -c "rom_escalate" bridge/watcher.js` → 1
- `node -c bridge/watcher.js` → exits 0
- `git diff --stat main` → 1 file changed: `bridge/watcher.js` (+15 lines)
- No test files exist; none created.
- `docs/` untouched.
