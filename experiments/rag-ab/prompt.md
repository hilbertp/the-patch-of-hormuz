Add a new module `bridge/state/gate-history.js` to this codebase. Requirements:

1. Export a single function: `getRecentGateEvents(limit = 50)` that reads `bridge/register.jsonl`, filters for events whose `event` field starts with `gate-`, returns the last `limit` events as an array, parsed.
2. Match the existing module style in `bridge/state/`: `'use strict'`, `module.exports = { ... }` shape, error handling consistent with `atomic-write.js` and `gate-mutex.js`.
3. Use `path.resolve(__dirname, '..', 'register.jsonl')` for the path, matching the convention in sibling modules.
4. Add a brief JSDoc comment block explaining the function.
5. Add a unit test at `bridge/test/state-gate-history.test.js` using node:test, similar in shape to `bridge/test/state-gate-mutex.test.js`.
6. Do NOT modify any existing file. Only create the two new files.

Stop when both files are written. Report what you created.
