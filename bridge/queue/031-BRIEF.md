---
id: "031"
title: "Fix evaluator JSON parser: handle markdown code block wrapping"
goal: "The evaluator correctly parses Claude's JSON response even when preceded by preamble text or wrapped in a code block."
from: kira
to: obrien
priority: spike
created: "2026-04-09T18:25:00Z"
references: "026"
timeout_min: null
---

## Objective

The evaluator in `bridge/watcher.js` is failing to parse Claude's JSON response. Claude returns valid JSON but prefixes it with preamble text and wraps it in a markdown code block. The current parser treats the full stdout as raw JSON and fails. Fix the parser.

## Evidence from bridge.log

```
"error": "Unexpected token 'A', \"All claims\"... is not valid JSON",
"stdout": "All claims verified. Here's the evaluation:\n\n```json\n{\n  \"verdict\": \"ACCEPTED\",\n  ...
```

Claude's response format:
```
All claims verified. Here's the evaluation:

```json
{
  "verdict": "ACCEPTED",
  "reason": "...",
  ...
}
```
```

## Fix

In `invokeEvaluator()` in `bridge/watcher.js`, update the JSON extraction logic to:

1. First try to extract JSON from inside a markdown code block: match ` ```json\n{...}\n``` ` pattern
2. If not found, try ` ```\n{...}\n``` ` (untyped code block)
3. If not found, try regex to find the first `{` to last `}` in the output
4. If still not found, try to parse the full stdout as raw JSON
5. If all fail, log and requeue

The extraction should use something like:
```js
function extractJSON(stdout) {
  // Try markdown code block with json tag
  const codeBlockMatch = stdout.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (codeBlockMatch) {
    try { return JSON.parse(codeBlockMatch[1]); } catch (_) {}
  }
  // Try first { to last }
  const start = stdout.indexOf('{');
  const end = stdout.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    try { return JSON.parse(stdout.slice(start, end + 1)); } catch (_) {}
  }
  // Try raw
  try { return JSON.parse(stdout); } catch (_) {}
  return null;
}
```

## Constraints

- Only modify the JSON extraction logic inside `invokeEvaluator()`. Do not change the evaluator prompt, verdict handling, or any other logic.
- The fix must handle all three formats: preamble + code block, raw JSON, and code block without preamble.

## Success Criteria

- [ ] `extractJSON()` helper (or equivalent inline logic) correctly parses JSON from preamble + ```json code block format
- [ ] Existing raw JSON parsing still works as fallback
- [ ] Evaluator successfully processes a commission end-to-end without "Failed to parse evaluator JSON response" errors
- [ ] Change committed on a branch and DONE report written
