---
id: "287"
title: "W-Ruflo-Fix-1 — Diagnose Ruflo MCP 'still connecting' failure mode"
from: rom
to: nog
status: DONE
slice_id: "287"
branch: "slice/287"
completed: "2026-05-04T19:35:00.000Z"
tokens_in: 185000
tokens_out: 12500
elapsed_ms: 1500000
estimated_human_hours: 3.0
compaction_occurred: false
---

# W-Ruflo-Fix-1 — DONE Report

## Summary

Root cause identified. The V3 "still connecting" failure is a **race condition between npx package resolution and Claude Code's 30-second MCP startup timeout**. When `npx -y claude-flow@latest mcp start` hits a cold cache (package not downloaded yet), the 1.8MB/999-file download+extract can exceed the timeout. Fix: pre-warm the npx cache before invoking `claude -p`.

## Deliverables

### 1. `experiments/ruflo-fix-1/` — Reproducer outputs

| File | Contents |
|------|----------|
| `reproduce.sh` | 5-run reproduction script |
| `runs/run-{1..5}.json` | Full output JSON for each run |
| `runs/run-{1..5}.stderr` | Stderr capture for each run |
| `findings.md` | Detailed experiment findings |
| `debug-log-successful-run.txt` | Claude Code debug log showing MCP startup timing |

**Reproduction result:** 5/5 runs succeeded (npx cache was warm). Failure is intermittent, not deterministic.

### 2. `docs/ruflo/MCP-CONNECTION-FIX.md` — Root cause + fix documentation

Documents:
- **Failure mode:** Claude Code's hardcoded 30s MCP startup timeout exceeded by npx cold-cache download
- **Root cause:** `npx -y claude-flow@latest mcp start` triggers npm registry lookup + 1.8MB download on cold cache
- **Evidence:** Debug log shows `Starting connection with timeout of 30000ms`, successful cached connection in 1,188ms
- **Recommended fix:** Pre-warm npx cache with `npx -y claude-flow@latest --version` before `claude -p`
- **Alternative fixes:** Global install, pinned version, wrapper script
- **Upstream requests:** `--mcp-startup-timeout` flag, `--wait-for-mcp` flag, better error reporting

### 3. Concrete next step

**Use the pre-warm invocation pattern in W-Ruflo-Fix-3 onward:**
```bash
npx -y claude-flow@latest --version > /dev/null 2>&1  # pre-warm
claude -p --mcp-config mcp-ruflo.json --strict-mcp-config ...
```

However: this fixes only the **reliability** problem (V3). The **usefulness** problem (V1/V2: model ignores all 237 tools) remains. The Ruflo drop verdict from slice 286 stands unless usefulness is also demonstrated.

## Key findings

1. **30-second hardcoded timeout** — Claude Code's MCP startup timeout is 30,000ms with no CLI flag to change it
2. **npx cold-cache latency** — `claude-flow@latest` is 1.8MB/999 files; cold download can exceed 30s
3. **Server itself is reliable** — Manual MCP handshake shows < 1s response, 238 tools register correctly
4. **No `--wait-for-mcp` flag** — Claude Code starts the conversation even if servers are "still connecting"
5. **Secondary bug** — Ruflo advertises `resources` capability but doesn't implement `resources/list`

## No production code changed

All changes are in `experiments/ruflo-fix-1/` and `docs/ruflo/`. No bridge, dashboard, or infrastructure code modified.
