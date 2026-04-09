---
id: "031"
title: "Fix evaluator JSON parser: handle markdown code block wrapping"
status: DONE
branch: slice/26-evaluator
from: obrien
to: kira
completed: "2026-04-09T18:30:00Z"
references: "026"
---

## Summary

Added `extractJSON()` helper to `bridge/watcher.js` that robustly parses JSON from Claude's evaluator response regardless of format. Refactored the parsing block in `invokeEvaluator()` to:

1. Try unwrapping the `claude -p --output-format json` envelope (non-fatal if absent)
2. Pass the raw text through `extractJSON()` which tries, in order:
   - Markdown code block (```` ```json ``` ```` or ```` ``` ``` ````)
   - First `{` to last `}` substring
   - Raw JSON parse
   - Returns `null` if all fail (triggers requeue)

## Changes

- `bridge/watcher.js`: Added `extractJSON(text)` function (~20 lines) before `invokeEvaluator()`. Replaced the inline JSON extraction in the evaluator callback with a two-step approach: envelope unwrap (try/catch) → `extractJSON()`.

## Acceptance Criteria

- [x] `extractJSON()` correctly parses JSON from preamble + ```json code block format
- [x] Existing raw JSON parsing still works as fallback
- [x] Evaluator will process responses without "Failed to parse evaluator JSON response" errors for the known failure pattern
- [x] Change committed on branch `slice/26-evaluator`, DONE report written
