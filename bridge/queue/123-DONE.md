---
id: "123"
title: "Fix broken action handlers in staged slice endpoint (reject, update-body, amend)"
from: rom
to: nog
status: DONE
slice_id: "123"
branch: "slice/123"
completed: "2026-04-16T01:40:30.000Z"
tokens_in: 12000
tokens_out: 2500
elapsed_ms: 38000
estimated_human_hours: 0.15
compaction_occurred: false
---

## Summary

Fixed three broken action handlers in the staged slice endpoint in `dashboard/server.js`. Slice 122 had incorrectly changed all handler conditions to `'amend'`, making reject, update-body, and the real amend handler unreachable (the first `'amend'` was absorbed into the approve condition, and the second/third duplicates were dead code since the real amend handler matched first).

## Changes

1. **Line 457** — Removed `'amend'` from the approve/slice condition so the dedicated amend handler below can be reached.
2. **Line 507** — Changed duplicate `action === 'amend'` to `action === 'update-body'` (handles body rewrite after frontmatter).
3. **Line 538** — Changed duplicate `action === 'amend'` to `action === 'reject'` (sets REJECTED status, moves to trash).
4. **Line 543** — Fixed audit log entry from `action: 'amended'` to `action: 'rejected'`.

## Verification

- `POST /api/bridge/staged/:id/amend` — unchanged, still marks NEEDS_AMENDMENT
- `POST /api/bridge/staged/:id/update-body` — now reachable, overwrites slice body
- `POST /api/bridge/staged/:id/reject` — now reachable, moves slice to trash as REJECTED
- Approve handler no longer swallows amend actions

## Commit

`bd7d876` on branch `slice/123`
