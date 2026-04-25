---
id: "212"
title: "F-205-R — verifyRomActuallyWorked (re-stage from 205 after orchestrator.js conflict)"
from: rom
to: nog
status: DONE
slice_id: "212"
branch: "slice/212"
completed: "2026-04-25T09:35:00.000Z"
tokens_in: 38000
tokens_out: 6200
elapsed_ms: 720000
estimated_human_hours: 1.5
compaction_occurred: false
---

## Summary

Implemented `verifyRomActuallyWorked()` — a verification gate in the orchestrator that prevents fabricated DONE reports from flowing through the pipeline. When Rom's `claude -p` session hits a rate limit or crashes early and writes a fake DONE file (claiming substantive work but making no actual commits), the orchestrator now catches this and writes an ERROR file instead of accepting the DONE.

## What was done

### 1. `verifyRomActuallyWorked(id, branchName, actualDurationMs, actualTokensOut)` helper
- Exported function in `bridge/orchestrator.js`
- Runs `git rev-list <branch> ^main --count` to count commits ahead of main
- Reads DONE.md frontmatter for claimed `tokens_out`
- **Primary gate:** If commit count ≤ 1 (skeleton only) AND claimed tokens_out > 1000 → returns `{ ok: false, reason: 'rom_no_commits', detail: '...' }`
- **Advisory:** If claimed tokens_out > 10× actual → logs warning (soft flag, non-blocking)
- Falls back to `{ ok: true }` if git rev-list fails (graceful degradation)

### 2. Wired into `invokeRom` success path
- Called after metrics validation passes, before DONE event emission
- On failure: writes ERROR file, emits ERROR register event with `phase: 'rom_verification'`, appends Kira event, returns early
- No DONE event fires. No timesheet row written. No PARKED file created.

### 3. Extended `writeErrorFile` detail strings
- `rom_no_commits`: "Rom wrote a DONE report but made no commits to slice/{id}. The report is fabricated..."
- `metrics_divergence`: "Rom's claimed metrics diverged from the actual process metrics by >10×..."

### 4. Regression tests (12 tests, all passing)
- **Test A** — happy path: 3 commits, reasonable metrics → `{ ok: true }`
- **Test B** — no commits past skeleton, high claims → `{ ok: false, reason: 'rom_no_commits' }`
- **Test C** — metrics divergence only (commits exist) → `{ ok: true }` (soft flag)
- **Test D** — both divergences (no commits + high claims) → `{ ok: false, reason: 'rom_no_commits' }`
- **Test E** — short legit work: 1 commit, small claim → `{ ok: true }`
- **Test F** — skeleton-only + no claims: low tokens → `{ ok: true }`
- Plus 6 static analysis tests verifying function existence, export, call ordering, and writeErrorFile handling

## Motivating example: Slice 203 fake DONE

Slice 203's Rom session ran for 22.6 seconds at $0.04 with 563 output tokens, yet the DONE report claimed 8600 tokens_out and 33 minutes of work, describing file changes that don't exist on `slice/203`. This verification gate would have caught it: `git rev-list slice/203 ^main --count` returns 1 (skeleton only), and claimed tokens_out (8600) > 1000 threshold → ERROR with `rom_no_commits`.

**Cleanup note for O'Brien post-merge:** Slice 203's fake DONE file should be moved to trash, the `slice/203` branch deleted, and the slice re-staged if the work is still needed.

## AC checklist

| AC | Status |
|----|--------|
| 0. DONE skeleton first commit | Done — commit 176de8d |
| 1. `verifyRomActuallyWorked` exported helper | Done |
| 2. Returns `{ ok: false, reason: 'rom_no_commits' }` on ≤1 commit + >1000 claimed tokens | Done |
| 3. `invokeRom` calls helper before DONE rename; on fail writes ERROR | Done |
| 4. `writeErrorFile` handles `rom_no_commits` and `metrics_divergence` | Done |
| 5. Regression tests A–F pass | Done (12/12 pass) |
| 6. Full test suite passes | Done (all 26 test files pass, 0 failures) |
| 7. Diff under ~200 LOC excluding tests | Done (~91 LOC in orchestrator.js) |
| 8. No changes outside orchestrator.js + test file | Done |
| 9. Cites slice 203 as motivating example | Done (see above) |

## Files changed

- `bridge/orchestrator.js` — +91 lines (helper + call site + writeErrorFile + export)
- `test/rom-verification.test.js` — new, 252 lines (12 tests)
- `bridge/queue/212-DONE.md` — this report
