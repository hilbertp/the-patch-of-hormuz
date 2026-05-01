---
id: "277"
title: "W-Ruflo-1 — claude-flow + agentic-flow probe and invocation surface mapping"
from: rom
to: nog
status: DONE
slice_id: "277"
branch: "slice/277"
completed: "2026-05-01T13:20:00.000Z"
tokens_in: 85000
tokens_out: 12000
elapsed_ms: 600000
estimated_human_hours: 3.0
compaction_occurred: false
---

# W-Ruflo-1 — DONE Report

## Summary

Probed `claude-flow` v3.6.12 and `agentic-flow` v2.0.7 in a sandboxed `experiments/ruflo-probe/` directory. Ran all 8 probe checklist steps for both tools. Captured raw output in `probe-*.txt` files and wrote structured findings to `docs/ruflo/RUFLO-PROBE-FINDINGS.md`.

## Recommendation

**Path 4: Neither tool fits the `claude -p` invocation swap goal.**

- `claude-flow` is an orchestration platform (237 MCP tools, swarm coordination). It has NO headless single-shot prompt CLI command. It manages agent lifecycles, not prompt execution.
- `agentic-flow` has a headless CLI (`--agent coder --task "..."`) but calls the Anthropic Messages API directly — not `claude -p`. No tool use, no file access, no CLAUDE.md loading. The response is a raw LLM completion, not a Claude Code agent action.
- For multi-provider routing, agentic-flow's proxy mode could sit in front of `claude -p` (set `ANTHROPIC_BASE_URL`), but that's a provider-routing change, not an invocation swap.

## Deliverables

| Deliverable | Status |
|---|---|
| `experiments/ruflo-probe/package.json` | ✅ Created |
| `experiments/ruflo-probe/package-lock.json` | ✅ Created |
| Both packages installed at exact versions | ✅ claude-flow@3.6.12, agentic-flow@2.0.7 |
| 8 probe steps per tool | ✅ All run, raw output captured |
| `probe-*.txt` files | ✅ 14 files in probe dir |
| `docs/ruflo/RUFLO-PROBE-FINDINGS.md` | ✅ All 7 sections populated |
| `.gitignore` updated | ✅ `experiments/*/node_modules/` added |
| No changes to bridge/orchestrator.js | ✅ Untouched |
| No changes to .claude/ or role files | ✅ Untouched |
| No new top-level npm dependencies | ✅ Sandboxed only |

## Key Findings

1. **claude-flow** = orchestration platform, not a CLI tool. 237 MCP tools. No `run`/`prompt`/`exec` command.
2. **agentic-flow** = API wrapper + proxy. Has `--agent --task` for headless execution but bypasses Claude Code entirely.
3. **agentic-flow proxy** is the interesting piece: routes `claude` CLI traffic through OpenRouter/Gemini for cost savings.
4. The invocation layer doesn't need swapping — the provider routing layer does, via `ANTHROPIC_BASE_URL`.

## What Was Not Determined

See Section 7 of RUFLO-PROBE-FINDINGS.md — 10 explicit unknowns including live invocation output shape, proxy latency, streaming compatibility, and ONNX quality.
