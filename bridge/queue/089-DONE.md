---
id: "089"
title: "Wormhole MCP server — core"
from: obrien
to: kira
status: DONE
slice_id: "089"
branch: "slice/089-wormhole-core"
completed: "2026-04-16T12:45:00.000Z"
tokens_in: 52000
tokens_out: 8500
elapsed_ms: 420000
estimated_human_hours: 3.0
compaction_occurred: false
---

## Summary

Built the production Wormhole MCP server at `wormhole/`. All four write tools plus `wormhole_ping` health check implemented with full security enforcement. Integration tests pass (12/12).

## Files created

| File | Purpose |
|---|---|
| `wormhole/package.json` | Package manifest — `@ds9/wormhole`, CommonJS, MCP SDK ^1.29.0 |
| `wormhole/config.js` | Loads & validates `WORMHOLE_WORKSPACE_ROOT` from env, fails fast |
| `wormhole/logging.js` | Structured JSON logger — stderr only, never stdout |
| `wormhole/security.js` | `safePath()` — rejects absolute, `..`, symlink escape |
| `wormhole/server.js` | MCP server with 5 tools, heartbeat sidecar, try/catch on all |
| `wormhole/tests/security.test.js` | 12 integration tests covering security + validation |

## Tools registered

1. **`wormhole_write_file(path, content, options?)`** — write/overwrite with optional encoding
2. **`wormhole_append_jsonl(path, line)`** — append validated JSON object as line
3. **`wormhole_move(from, to)`** — rename within workspace, both paths validated
4. **`wormhole_delete(path)`** — single file delete, no recursive
5. **`wormhole_ping(nonce)`** — health check, writes `bridge/wormhole-ping.json`

## Security enforcement

- Absolute paths → rejected with descriptive error
- `..` segments → rejected before resolution
- Symlink escape → caught via `realpathSync` canonicalization
- Workspace root itself canonicalized to handle macOS `/tmp` → `/private/tmp`
- All tool handlers wrapped in try/catch — never throw to SDK

## Tests (12/12 pass)

- Path traversal (`../../../etc/passwd`) → rejected
- Path traversal (`foo/../../etc/passwd`) → rejected
- Absolute path → rejected
- Symlink escape → rejected
- Valid relative path → resolves correctly
- Nested non-existent path → resolves correctly
- Invalid JSONL (string) → rejected
- Invalid JSONL (array) → rejected
- Invalid JSONL (null) → rejected
- Valid JSONL object → accepted
- Write to missing parent dir → creates parents, succeeds
- Invalid JSON does not create file

## Heartbeat sidecar

Every successful tool call overwrites `bridge/wormhole-heartbeat.json` with `{ ts, tool, path }`. Already in `.gitignore`.

## No `console.log`

Verified: zero `console.log` calls in any `wormhole/` file. All logging via stderr.
