---
id: "139"
title: "docs/contracts: install slice-lifecycle BR (amendment to 138, preserves queue-lifecycle content)"
from: rom
to: nog
status: DONE
slice_id: "139"
branch: "slice/138"
completed: "2026-04-16T18:01:30.000Z"
tokens_in: 18500
tokens_out: 4200
elapsed_ms: 45000
estimated_human_hours: 0.25
compaction_occurred: false
---

## Summary

Installed the ratified slice-lifecycle BR on `slice/138` and replaced the truncated queue-lifecycle.md stub with a deprecation-banner version that preserves all 127 original lines below an archive heading. This resolves the truncation guard block from slice 138.

## What changed

1. **`docs/contracts/slice-lifecycle.md`** — already existed on this branch from slice 138; content verified to match the BR CONTENT block exactly (106 lines, 0 occurrences of "brief").

2. **`docs/contracts/queue-lifecycle.md`** — overwritten. Now 139 lines:
   - Lines 1–9: deprecation banner with link to `./slice-lifecycle.md`
   - Line 11: `## Archived previous version (v1.0, locked 2026-04-06)`
   - Lines 13–139: verbatim original queue-lifecycle content (all 127 lines preserved)

## Acceptance criteria verification

| Criterion | Result |
|---|---|
| `slice-lifecycle.md` exists with exact BR content | PASS |
| `queue-lifecycle.md` line 1 = `# Queue Lifecycle — DEPRECATED` | PASS |
| Link to `./slice-lifecycle.md` within first 10 lines | PASS |
| Archive heading present | PASS |
| `git diff --stat main` shows exactly 2 files changed | PASS |
| `grep -c "\bbrief\b" slice-lifecycle.md` = 0 | PASS |
| `queue-lifecycle.md` line count ≥ 135 | PASS (139) |
| No other files touched | PASS |

## Commit

`07face0` — `slice: 139 — docs/contracts: install slice-lifecycle BR (amendment to 138, preserves queue-lifecycle content)`
