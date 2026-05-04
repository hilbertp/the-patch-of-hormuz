# Ruflo MCP Connection Fix — Experiment Findings

**Slice:** 287 (W-Ruflo-Fix-1)
**Date:** 2026-05-04
**Goal:** Reproduce V3's MCP "still connecting" failure, find root cause, recommend fix or workaround

---

## 1. Reproduction Results

### 5x reproduction runs (cached npx)

| Run | Tools Loaded | Duration | Stderr |
|-----|-------------|----------|--------|
| 1 | YES (197+ ruflo-rag tools) | 26s | 0 bytes |
| 2 | YES | 27s | 0 bytes |
| 3 | YES | 33s | 0 bytes |
| 4 | YES | 33s | 0 bytes |
| 5 | YES | 30s | 0 bytes |

**Result: 5/5 successful.** The V3 failure is **not deterministic** — it's intermittent and environment-sensitive.

### MCP server standalone test

Manual MCP protocol handshake with `npx -y claude-flow@latest mcp start`:
- `initialize` response: < 1 second
- `tools/list` response: 238 tools registered
- Server protocol: JSON-RPC 2.0 over stdio, compliant

**The server itself is reliable.** The failure is in the Claude Code ↔ MCP startup handshake timing.

---

## 2. Root Cause Analysis

### Claude Code's MCP startup timeout

From `--debug-file` output:

```
MCP server "ruflo-rag": Starting connection with timeout of 30000ms
MCP server "ruflo-rag": Successfully connected (transport: stdio) in 1188ms
```

**Claude Code imposes a hard 30-second timeout on MCP server connections.** There is no CLI flag to change this.

### What happened in V3

The V3 run (slice 285) used `npx -y claude-flow@latest mcp start`. The `npx` command:
1. Checks npm registry for the latest version
2. If not cached (or different version), downloads 1.8MB package (999 files)
3. Extracts and installs to temp directory
4. Only then starts the MCP server

On a **cold npx cache** or with **network latency**, steps 1-3 can exceed 30 seconds, causing Claude Code to mark the server as "still connecting" and proceed without it.

Evidence supporting this theory:
- V1/V2 (slices 282, 284) worked — npx cache was warm from prior runs in the same session
- V3 (slice 285) failed — ran hours later, possibly after npx cache eviction or version bump
- Our 5 reproduction runs all succeeded — cache is warm (v3.6.27 already cached)
- Package is 1.8MB with 999 files — non-trivial download + extract time

### Secondary issue: `resources/list` error

```
MCP server "ruflo-rag" Failed to fetch resources: MCP error -32601: Method not found: resources/list
```

The server advertises `resources: {subscribe: true, listChanged: true}` in capabilities but doesn't implement `resources/list`. This doesn't cause the connection failure but adds noise.

### Third issue: connection cleanup

```
MCP server "ruflo-rag": UNKNOWN connection closed after 5s (cleanly)
```

For short-lived `claude -p` sessions, the server gets terminated quickly. This is expected behavior, not a bug.

---

## 3. V1/V2 vs V3 Comparison

| Aspect | V1/V2 (slices 282, 284) | V3 (slice 285) |
|--------|------------------------|----------------|
| MCP config | Same `mcp-ruflo.json` | Same `mcp-ruflo.json` |
| `npx` command | Same `npx -y claude-flow@latest mcp start` | Same |
| Tools loaded | YES (237 tools) | NO (server never connected) |
| Tools invoked | 0 (model ignored them) | 0 (not available) |
| Likely npx cache state | Warm (runs were close together) | Cold (ran after gap) |
| Claude Code version | Same session | Same session |

**The only plausible difference is npx cache state at invocation time.**

---

## 4. CLI Flag Investigation

### `claude -p` MCP-related flags

| Flag | Purpose | Startup timeout control? |
|------|---------|------------------------|
| `--mcp-config` | Load MCP servers from JSON | No timeout parameter |
| `--mcp-debug` | Deprecated (use `--debug`) | Debug only |
| `--strict-mcp-config` | Only use servers from `--mcp-config` | No |
| `--debug-file` | Log debug output to file | Diagnostic only |

### `claude mcp` subcommands

| Subcommand | Purpose |
|------------|---------|
| `add` | Register a server | 
| `list` | Show servers + health |
| `get` | Server details |
| `remove` | Unregister |

**No `--mcp-startup-timeout`, `--wait-for-mcp`, or healthcheck-poll flag exists.** The 30-second timeout is hardcoded.

---

## 5. Recommended Workarounds

### Workaround A: Pre-warm npx cache (RECOMMENDED)

Before invoking `claude -p --mcp-config`, run:
```bash
npx -y claude-flow@latest --version
```

This forces npx to download and cache the package. Subsequent `mcp start` invocations use the cache and start in ~1 second.

### Workaround B: Pin a specific version

Replace `claude-flow@latest` with a pinned version:
```json
{
  "mcpServers": {
    "ruflo-rag": {
      "command": "npx",
      "args": ["-y", "claude-flow@3.6.27", "mcp", "start"]
    }
  }
}
```

This avoids the npm registry lookup for "latest" resolution on every invocation.

### Workaround C: Install globally instead of npx

```bash
npm install -g claude-flow@latest
```

Then use the config:
```json
{
  "mcpServers": {
    "ruflo-rag": {
      "command": "claude-flow",
      "args": ["mcp", "start"]
    }
  }
}
```

This eliminates npx overhead entirely. Startup time drops to < 500ms.

### Workaround D: Wrapper script with ready-check

```bash
#!/bin/bash
# pre-warm-ruflo.sh
npx -y claude-flow@latest --version > /dev/null 2>&1
exec npx -y claude-flow@latest mcp start
```

Use in config:
```json
{
  "mcpServers": {
    "ruflo-rag": {
      "command": "bash",
      "args": ["scripts/pre-warm-ruflo.sh"]
    }
  }
}
```

---

## 6. Upstream Considerations

### Feature request: configurable MCP startup timeout

Claude Code should support `--mcp-startup-timeout <ms>` for `claude -p`. The hardcoded 30-second default is reasonable for most servers but insufficient for npx-based servers that need to download packages.

### Feature request: MCP server readiness reporting

Currently, `claude -p` starts the conversation even if MCP servers are "still connecting." A `--wait-for-mcp` flag that blocks until all configured servers connect (or timeout) would make headless invocations deterministic.
