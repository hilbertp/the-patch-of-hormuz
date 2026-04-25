---
id: "211"
title: "F-W2 — post-merge SHA assertion (integrity guard)"
from: rom
to: nog
status: DONE
slice_id: "211"
branch: "slice/211"
completed: "2026-04-25T10:05:00.000Z"
tokens_in: 28000
tokens_out: 6500
elapsed_ms: 420000
estimated_human_hours: 1.0
compaction_occurred: false
---

## Summary

Added `assertMergeIntegrity(id, expectedSha)` — a post-merge local integrity guard (W2) that asserts the SHA recorded after `git update-ref` is both an ancestor of `main` and the current tip.

## Changes

### `bridge/orchestrator.js`
- **New function `assertMergeIntegrity(id, expectedSha)`** (around line 2499): Runs two git checks via `gitFinalizer.runGit`:
  1. `git merge-base --is-ancestor <expectedSha> main` — verifies ancestry
  2. `git rev-parse main` === expectedSha — verifies tip match
  Returns `{ ok: true }` on success, `{ ok: false, actualSha, reason }` on failure with reason ∈ `{ not_ancestor, tip_mismatch, check_failed }`.

- **Call site in `mergeBranch()`** (Step 2.5): Called immediately after `git update-ref refs/heads/main` and before the file-sync loop. On failure:
  - Emits `MERGE_INTEGRITY_VIOLATION` register event with fields: `ts`, `slice_id`, `event`, `expected_sha`, `actual_sha`, `reason`
  - Logs at `warn` level
  - Returns `{ success: false, sha: null, error: 'merge_integrity_violation' }` — skipping file-sync, git push, and MERGED emission
  - The `finally` block (re-lock) still runs normally

- **Exported `assertMergeIntegrity`** in `module.exports` for test access.

- **No change needed to `handleAccepted`**: Already gates MERGED emission on `result.success` — integrity failures naturally flow through the existing `else` branch (MERGE_FAILED log + no MERGED event).

### `test/orchestrator-merge-integrity.test.js` (new file)
8 regression tests covering:
- **A** — happy path: valid SHA → `{ ok: true }`
- **B** — not_ancestor: unreachable SHA → `{ ok: false, reason: 'not_ancestor' }`
- **C** — tip_mismatch: ancestor but not tip → `{ ok: false, reason: 'tip_mismatch' }`
- **D** — register emission: MERGE_INTEGRITY_VIOLATION event with correct fields
- **E** (4 tests) — source-level integration: call site ordering, failure return shape, registerEvent emission, handleAccepted success gate

## Acceptance criteria

| AC | Status | Notes |
|----|--------|-------|
| AC1 | PASS | `assertMergeIntegrity` exists with specified contract |
| AC2 | PASS | Called between `git update-ref` and file-sync loop |
| AC3 | PASS | Returns `{ success: false, sha: null, error: 'merge_integrity_violation' }` |
| AC4 | PASS | No MERGED event on failure (handleAccepted gates on `result.success`) |
| AC5 | PASS | MERGE_INTEGRITY_VIOLATION event emitted with all required fields |
| AC6 | PASS | `git push origin main` not called (early return before push) |
| AC7 | PASS | Happy path unchanged — success still returns `{ success: true, sha, error: null }` |
| AC8 | PASS | Test file exists with cases A–E (8 tests, all passing) |
| AC9 | PASS | Lock/unlock sequence unchanged — assertion runs inside unlocked window |

## Test results

```
8 tests: 8 passed, 0 failed
```
