---
id: "062"
title: "Fix token extraction — handle JSONL output from claude -p"
goal: "The watcher terminal shows real token counts instead of 'tokens: unknown' after every commission."
from: kira
to: obrien
priority: high
created: "2026-04-12T00:00:00Z"
references: null
timeout_min: 10
branch: "fix/62-token-extraction"
status: "PENDING"
---

## The bug

`extractTokenUsage(stdout)` in `bridge/watcher.js` calls `JSON.parse(stdout.trim())` and expects a single JSON object. But `claude -p --output-format json` produces streaming JSONL — multiple JSON objects, one per line. `JSON.parse` fails on multi-line input, falls into the catch, and returns `{ tokensIn: null, tokensOut: null }`, which renders as "tokens: unknown".

## The fix

Update `extractTokenUsage` to handle JSONL. Try single-JSON parse first (for forward compat), then fall back to scanning each line for a JSON object that contains usage data.

Find the current function (around line 174):

```js
function extractTokenUsage(stdout) {
  try {
    const data = JSON.parse(stdout.trim());
    const usage = data.usage || {};
    const tokensIn  = typeof usage.input_tokens  === 'number' ? usage.input_tokens  : null;
    const tokensOut = typeof usage.output_tokens === 'number' ? usage.output_tokens : null;
    return { tokensIn, tokensOut };
  } catch (_) {
    return { tokensIn: null, tokensOut: null };
  }
}
```

Replace with:

```js
function extractTokenUsage(stdout) {
  if (!stdout || !stdout.trim()) return { tokensIn: null, tokensOut: null };

  // Helper: extract token counts from a parsed JSON object.
  // Handles both { usage: { input_tokens, output_tokens } } and
  // { result: { usage: ... } } shapes.
  function fromParsed(data) {
    if (!data || typeof data !== 'object') return null;
    const usage = data.usage
      || (data.result && data.result.usage)
      || {};
    const tokensIn  = typeof usage.input_tokens  === 'number' ? usage.input_tokens  : null;
    const tokensOut = typeof usage.output_tokens === 'number' ? usage.output_tokens : null;
    if (tokensIn == null && tokensOut == null) return null;
    return { tokensIn, tokensOut };
  }

  // Try single JSON first (future-proof if Claude ever emits one object).
  try {
    const result = fromParsed(JSON.parse(stdout.trim()));
    if (result) return result;
  } catch (_) {}

  // Fall back to JSONL — scan each line, return the first line with usage data.
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const result = fromParsed(JSON.parse(trimmed));
      if (result) return result;
    } catch (_) {}
  }

  return { tokensIn: null, tokensOut: null };
}
```

## Verify

After making the change, check that `bridge/bridge.config.json` still has `--output-format json` in `claudeArgs` (it should — commission 054 added it). If missing, add it back.

## Constraints

- Branch: `fix/62-token-extraction`
- Touch only `bridge/watcher.js` (and `bridge/bridge.config.json` if the flag is missing)

## Success criteria

1. `extractTokenUsage` tries single JSON parse first, then scans JSONL lines
2. `bridge/bridge.config.json` has `--output-format json` in `claudeArgs`
3. DONE report includes all 5 metrics fields with real non-null values
