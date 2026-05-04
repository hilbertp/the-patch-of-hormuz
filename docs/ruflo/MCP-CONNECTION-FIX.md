# MCP Connection Fix — Ruflo "Still Connecting" Failure Mode

**Slice:** 287 (W-Ruflo-Fix-1)
**Date:** 2026-05-04
**Author:** O'Brien (via Rom)
**Status:** Root cause identified, workaround available

---

## Failure Mode

When invoking `claude -p --mcp-config mcp-ruflo.json`, the Ruflo MCP server (`claude-flow`) intermittently fails to register tools. Claude Code reports the server as "still connecting" throughout the session. Zero `mcp__ruflo-rag__*` tools are available. The model falls back to native tools.

This was observed in slice 285 (W-RAG-AB-3) where the V3 experiment produced a complete result using only native tools because Ruflo's MCP server never connected.

---

## Root Cause

**Claude Code's MCP startup timeout (30 seconds) can be exceeded by `npx` package resolution on cold cache.**

### The chain of events

1. `claude -p --mcp-config` spawns the MCP server process: `npx -y claude-flow@latest mcp start`
2. `npx` must: check npm registry → download 1.8MB package (999 files) → extract → execute
3. Claude Code starts a 30-second connection timer
4. If `npx` download + extract takes > 30 seconds, Claude Code marks the server as failed
5. The session begins without MCP tools — they show as "still connecting" permanently

### Evidence

| Observation | Implication |
|------------|-------------|
| Debug log: `Starting connection with timeout of 30000ms` | Hard 30s timeout, no CLI flag to change |
| Cached npx: server connects in **1,188ms** | Cache-warm startup is fast |
| Package: 1.8MB, 999 files, `@latest` tag | Cold-cache download is non-trivial |
| V1/V2 worked (tools loaded) | Cache was warm from prior runs |
| V3 failed (server never connected) | Cache was likely cold (time gap between runs) |
| 5/5 reproduction runs succeeded | Cache warm after V3 populated it |

### Why it's intermittent

The failure depends on **npx cache state**, which is affected by:
- Time since last invocation (cache eviction)
- Version bumps (`@latest` forces re-download)
- Network latency to npm registry
- Disk I/O speed for 999-file extraction

---

## Recommended Fix

### For future experiments: pre-warm the npx cache

Add this line before any `claude -p --mcp-config` invocation:

```bash
npx -y claude-flow@latest --version > /dev/null 2>&1
```

This forces the download to complete before Claude Code's 30-second timer starts.

### Updated run script pattern

```bash
#!/bin/bash
set -e

# Pre-warm: ensure claude-flow is cached before claude -p starts the timer
echo "Pre-warming claude-flow..."
npx -y claude-flow@latest --version > /dev/null 2>&1

# Now safe to invoke — npx will use cache, startup < 2 seconds
echo "Running experiment..."
echo "$PROMPT" | claude -p --output-format json --permission-mode bypassPermissions \
  --mcp-config mcp-ruflo.json \
  > output.json 2> output.stderr
```

### Alternative: global install (eliminates npx entirely)

```bash
npm install -g claude-flow@3.6.27

# Config uses command directly, no npx overhead
# mcp-ruflo.json:
# { "mcpServers": { "ruflo-rag": { "command": "claude-flow", "args": ["mcp", "start"] } } }
```

---

## What Claude Code should fix (upstream)

1. **`--mcp-startup-timeout <ms>` flag** — Allow users to override the 30-second default for `claude -p` invocations. Especially important for npx-based servers.

2. **`--wait-for-mcp` flag** — Block until all configured MCP servers connect or timeout, rather than starting the conversation with "still connecting" servers. This would make headless `claude -p` invocations deterministic.

3. **Better error reporting** — When an MCP server times out, emit a clear warning in the output JSON (not just debug logs) so automated pipelines can detect and handle it.

---

## Concrete Next Step

**Use the pre-warm pattern in all future Ruflo experiments** (W-Ruflo-Fix-3 onward).

However, this fix only addresses the **reliability** problem (V3: server didn't connect). It does not address the **usefulness** problem (V1/V2: tools connected but the model ignored all 237 of them). The Ruflo drop verdict from slice 286's consolidated findings still stands on usefulness grounds — fixing the connection doesn't make the tools valuable.

If the re-investigation portfolio proceeds despite the usefulness finding, use this invocation pattern:

```bash
npx -y claude-flow@latest --version > /dev/null 2>&1  # pre-warm
claude -p --mcp-config mcp-ruflo.json --strict-mcp-config ...  # strict to avoid noise from other servers
```

---

## Appendix: Debug Log Key Lines

```
[DEBUG] MCP server "ruflo-rag": Starting connection with timeout of 30000ms
[ERROR] MCP server "ruflo-rag" Server stderr: [...] Starting in stdio mode
[DEBUG] MCP server "ruflo-rag": Successfully connected (transport: stdio) in 1188ms
[DEBUG] MCP server "ruflo-rag": Connection established with capabilities: {"hasTools":true,...}
[ERROR] MCP server "ruflo-rag" Failed to fetch resources: MCP error -32601: Method not found: resources/list
[DEBUG] MCP server "ruflo-rag": UNKNOWN connection closed after 5s (cleanly)
```

Note: The `resources/list` error is a secondary bug — Ruflo advertises resource capabilities but doesn't implement the `resources/list` method. This doesn't cause the connection failure but adds error noise.
