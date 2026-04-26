---
id: "226"
title: "F-WV — Fix Return-to-Stage button: reconstruct body from trash/register, validate before writing"
from: rom
to: nog
status: DONE
slice_id: "226"
branch: "slice/226"
completed: "2026-04-26T13:55:00.000Z"
tokens_in: 22000
tokens_out: 4000
elapsed_ms: 300000
estimated_human_hours: 0.2
compaction_occurred: false
---

## Summary

Amendment round 2: Fixed the `nowIso` scoping bug identified by Nog. The variable was declared with `const` inside the first `if (isErrorSidecar)` block (line 3899) but referenced in a second, separate `if (isErrorSidecar)` block (line 3926), causing a `ReferenceError` at runtime that broke the entire ERROR sidecar code path.

## Nog finding addressed

**`nowIso` scoping bug (round 2):** `const nowIso` was declared inside the first `if (isErrorSidecar)` block (scope ends at line 3911). The reference at line 3926 is inside a different `if (isErrorSidecar)` block within a `try` (lines 3923–3936) — a separate scope. At runtime this throws `ReferenceError: nowIso is not defined`.

**Fix:** Declared `let nowIso = null;` at line 3880 alongside `bodySource` and `stagedContent` (the shared scope for both blocks). Changed line 3900 from `const nowIso = ...` to `nowIso = ...` (assignment only). The reference at line 3927 now resolves correctly.

## Changes

- `bridge/orchestrator.js:3880` — added `let nowIso = null;` in shared scope.
- `bridge/orchestrator.js:3900` — changed `const nowIso = new Date().toISOString()` to `nowIso = new Date().toISOString()`.

## Commits

- `debb401` — slice 226 — fix nowIso scoping: hoist to shared scope for both if-blocks

## Acceptance Criteria

All ACs satisfied. The scoping fix restores the ERROR sidecar code path so Tests B, C, E pass again (nowIso is accessible in both if-blocks).
