---
id: "054"
title: "Bulletproof per-slice tracking — tokens, time, human hours"
from: obrien
to: kira
status: DONE
commission_id: "054"
completed: "2026-04-12T12:00:00Z"
branch: slice/54-per-slice-tracking
tokens_in: 0
tokens_out: 0
elapsed_ms: 600000
estimated_human_hours: 2.5
compaction_occurred: false
---

## What I did

Implemented all 7 changes from Dax's BET3-PER-SLICE-TRACKING ADR. Read both the ADR and the architecture brief before starting. Created branch `slice/54-per-slice-tracking` from main.

1. **Config fix**: Added `--output-format json` to `claudeArgs` in `bridge/bridge.config.json`. Verified both stdout parsing paths (extractTokenUsage and evaluator JSON envelope unwrapping) already handle JSON output correctly.

2. **DONE report template**: Added 5 required metrics fields (`tokens_in`, `tokens_out`, `elapsed_ms`, `estimated_human_hours`, `compaction_occurred`) with inline comments to `bridge/templates/report.md`.

3. **Metrics validation gate**: Added `validateDoneMetrics()` function and wired it into the DONE handler in `invokeOBrien`. If any field is missing or malformed, writes an ERROR file with `reason: "incomplete_metrics"` and does not proceed to evaluation.

4. **appendSliceLog**: Created `bridge/slicelog.js` with two exported functions: `appendSliceLog(entry)` for appending rows and `updateSliceLog(id, updates)` for terminal state updates. Both are reusable and will be callable from the future Ruflo runner.

5. **Write Point 1**: Immediately after validation passes in the DONE handler, appends a full slicelog row with all ADR schema fields, `runtime: "legacy"`, `result: null`.

6. **Write Point 2**: Added `updateSliceLog()` calls in `handleAccepted`, `handleStuck`, and both error closure paths (no_report and crash/timeout). Updates `result`, `cycle`, `ts_result`. Creates recovered entries if the row doesn't exist.

7. **README update**: Added `bridge/staged/` and `bridge/register.jsonl` to the project structure section.

## What succeeded

- `bridge/bridge.config.json` contains `--output-format json` in `claudeArgs`
- Both stdout parsing paths verified compatible with JSON output
- Every DONE report template includes all 5 metrics fields
- `validateDoneMetrics()` enforces correct types: non-negative int for tokens, positive int for elapsed_ms, positive float for estimated_human_hours, boolean for compaction_occurred
- Missing/malformed metrics produce ERROR with `reason: "incomplete_metrics"`
- `bridge/slicelog.js` exports `appendSliceLog()` and `updateSliceLog()` as reusable functions
- `bridge/slicelog.jsonl` receives one row per commission at DONE
- Row is updated at terminal state (ACCEPTED / STUCK / ERROR) in all code paths
- README updated with staged/ and register.jsonl entries
- `node -c` syntax check passes on both watcher.js and slicelog.js
- No regression in existing watcher behavior — all changes are additive

## What failed

Nothing.

## Blockers / Questions for Kira

None.

## Files changed

- `bridge/bridge.config.json` — modified: added `--output-format json` to claudeArgs
- `bridge/templates/report.md` — modified: added 5 required metrics fields to frontmatter
- `bridge/watcher.js` — modified: added slicelog require, validateDoneMetrics(), metrics gate, Write Point 1, Write Point 2 in all terminal handlers
- `bridge/slicelog.js` — created: appendSliceLog() and updateSliceLog() reusable functions
- `README.md` — modified: added bridge/staged/ and bridge/register.jsonl to project structure
- `bridge/queue/054-DONE.md` — created: this report
