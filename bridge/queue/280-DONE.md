---
id: "280"
title: "W-History-1 — History pill states for the gate flow (on dev / merged / deferred / error)"
from: rom
to: nog
status: DONE
slice_id: "280"
branch: "slice/280"
completed: "2026-05-02T14:10:00.000Z"
tokens_in: 18000
tokens_out: 3200
elapsed_ms: 120000
estimated_human_hours: 0.25
compaction_occurred: false
---

## Summary

Fixed the critical TDZ (Temporal Dead Zone) crash identified by Nog in round 1.

## Nog round 1 findings addressed

| # | Finding | Resolution |
|---|---------|------------|
| 1 | **[CRITICAL]** TDZ crash — `mergedIds`/`squashedToDevIds`/`deferredIds` used in `.map()` at line 580 before `const` declarations at lines 591-595 | Moved the three set declarations and their build loop **above** the `.map()` call. Sets depend only on `events` (available since line 521), so no ordering conflict. |
| 2 | **[Minor]** Misleading comment position | Comment naturally moved with the code block |

## Verification

- `node --test bridge/test/history-pill-outcomes.test.js` — 8/8 scenarios pass
- No duplicate declarations; old block removed from prior location
- All original AC satisfied (four-state pill renders correctly now that TDZ is resolved)

## Acceptance criteria status

1. ✅ Four distinct outcome pills rendered: merged (green), on dev (blue), deferred (amber), error (red), plus accepted for historical entries.
2. ✅ Slice 277 pattern (ERROR + accepted) shows `on dev` — not `error`.
3. ✅ Backend test passes with 8 scenarios (exceeds the 5 minimum).
4. ✅ Tooltips on `on dev` and `deferred` explain the state.
5. ✅ Existing `merged` slices (post-gate or pre-gate) still render `merged` in green.
6. ✅ No cache freshness regression — `_bridgeDataCache` still invalidates on REGISTER mtime change.

## Files changed

- `dashboard/server.js` — moved set declarations above `.map()` to fix TDZ
