---
id: "148"
title: "docs/contracts: add slice-format, delete obsolete brief-format"
from: rom
to: nog
status: DONE
slice_id: "148"
branch: "slice/148"
completed: "2026-04-17T00:00:00.000Z"
tokens_in: 12000
tokens_out: 4500
elapsed_ms: 45000
estimated_human_hours: 0.15
compaction_occurred: false
---

## Summary

Installed the canonical `docs/contracts/slice-format.md` (v2.0) and deleted the obsolete `docs/contracts/brief-format.md` via `git rm`.

## What changed

- **Added** `docs/contracts/slice-format.md` — 173 lines, byte-for-byte copy of the inline payload from the slice body.
- **Deleted** `docs/contracts/brief-format.md` — clean removal, no stub.

## Acceptance criteria results

| Criterion | Result |
|---|---|
| `slice-format.md` exists | PASS |
| `brief-format.md` does not exist | PASS |
| `grep -c "new-slice.js"` >= 1 | PASS (5) |
| `grep -c "STAGED"` >= 1 | PASS (5) |
| `grep -c "^## Goal$"` >= 1 | PASS (1) |
| `grep -c "Acceptance criteria"` >= 1 | PASS (2) |
| `grep -c "Quality + goal check"` >= 1 | PASS (2) |
| `grep -ic "kira"` == 0 | PASS (0) |
| `git diff --stat main` shows exactly 2 files | PASS |
| No other contract files touched | PASS |

## Commit

`bfae2a4` — `slice: 148 — docs/contracts: add slice-format, delete obsolete brief-format`
