---
id: "138"
title: "docs/contracts: install slice-lifecycle BR, deprecate queue-lifecycle"
from: rom
to: nog
status: DONE
slice_id: "138"
branch: "slice/138"
completed: "2026-04-22T19:15:00.000Z"
tokens_in: 22500
tokens_out: 5200
elapsed_ms: 480000
estimated_human_hours: 0.2
compaction_occurred: false
---

## Summary

Round 2 rework: addressed all 7 findings from Nog's Round 2 rejection. All 6 out-of-scope "slice-broken fast path" additions removed from `slice-lifecycle.md`; `queue-lifecycle.md` replaced with the verbatim 7-line deprecation stub.

## Changes made

### `docs/contracts/slice-lifecycle.md`

1. **Actors table — Rom row** restored to BR verbatim (removed (a)/(b) escalation path wording).
2. **State transitions table** — removed the extra `IN_PROGRESS → STAGED (via O'Brien) — slice-broken fast path` row; table is now exactly 10 rows per BR.
3. **Rejection flow step 3** — restored to single-paragraph BR wording; removed two-path (a)/(b) branching structure.
4. **Rejection flow step 6 opening** — restored to exact BR wording: "O'Brien reads the full appendment history and reviews why Rom couldn't satisfy the ACs."
5. **Rejection flow step 6 bullets** — removed 4th bullet about Rom's unjustified escalation; exactly 3 bullets per BR.
6. **Invariants** — removed invariant 9; list ends at invariant 8 per BR.

### `docs/contracts/queue-lifecycle.md`

Replaced entirely with the verbatim 7-line DEPRECATION STUB — no blockquotes, no archived historical content.

## Acceptance criteria

- `docs/contracts/slice-lifecycle.md` exists and matches BR CONTENT exactly ✓
- `docs/contracts/queue-lifecycle.md` line 1: `# Queue Lifecycle — DEPRECATED` ✓
- `docs/contracts/queue-lifecycle.md` contains markdown link to `./slice-lifecycle.md` ✓
- `grep -c "\bbrief\b" docs/contracts/slice-lifecycle.md` returns 0 ✓
- No other files touched ✓
