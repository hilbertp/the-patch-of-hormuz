# RAG A/B Findings V3 — Forced Ruflo MCP Tool Usage Attempt

**Probe:** W-RAG-AB-3 (slice 285)
**Date:** 2026-05-04
**Task:** Produce a slice lifecycle summary by explicitly requiring claude-flow MCP tool invocations
**Prior:** [RAG-AB-FINDINGS.md](RAG-AB-FINDINGS.md) (V1, slice 282), [RAG-AB-FINDINGS-V2.md](RAG-AB-FINDINGS-V2.md) (V2, slice 284)

---

## 1. TL;DR

Rom **could not** call Ruflo tools because the MCP server never finished connecting. The `ruflo-rag` server (claude-flow) was listed as "still connecting" throughout the entire session. Zero `mcp__claude-flow__*` tools were registered. Rom searched for them 3 times via `ToolSearch`, got zero matches each time, and fell back to native tools (Read, Grep, Glob, Write). The final output is a coherent, accurate lifecycle summary — produced entirely without Ruflo.

**Verdict: Ruflo's MCP server is non-functional in this environment.** Three experiments (V1, V2, V3) spanning code-generation, cross-file retrieval, and forced tool invocation all show zero Ruflo tool usage. V1/V2: tools loaded but ignored. V3: tools failed to load at all. **Drop Ruflo-RAG permanently.**

---

## 2. Tool-call log

### Claude-flow tool attempts (all failed)

| # | Intended tool | ToolSearch query | Matches | Outcome |
|---|--------------|-----------------|---------|---------|
| 1 | `mcp__claude-flow__memory_usage` (store evidence) | `"mcp__claude-flow"`, `"+claude-flow"`, `"mcp memory store"` | 0 | MCP server "still connecting" — namespace empty |
| 2 | `mcp__claude-flow__performance_report` (analysis) | `"claude-flow analysis performance"` | 0 | No claude-flow tools registered |
| 3 | `mcp__claude-flow__task_orchestrate` (decompose) | `"claude-flow task"` | 0 | Only built-in TodoWrite/TaskOutput returned |

### Native tool usage (fallback — all succeeded)

| Tool | Target | Result |
|------|--------|--------|
| `Glob("bridge/state/*")` | State files | 7 files + .gitkeep |
| `Read` x6 | Each .js/.json in bridge/state/ | Headers extracted |
| `Read("docs/contracts/slice-lifecycle.md")` | Lifecycle spec | 8 states, transitions, invariants |
| `Grep("registerEvent")` | bridge/orchestrator.js | 35 call sites, 19+ event types |
| `Grep("registerEvent")` | bridge/git-finalizer.js | 12 call sites, 7 event types |
| `Glob("**/register*.jsonl")` | Register file | Not on disk (runtime artifact) |
| `Write` | experiments/rag-ab/run-3/output.md | Lifecycle summary written |

---

## 3. Cost / time vs slice 282 base run

| Metric | 282 Base (Run A) | 285 V3 (forced Ruflo) | Delta |
|--------|-----------------|----------------------|-------|
| Total cost (USD) | $0.292 | $0.557 | +91% (V3 costlier) |
| Wall time | 50s | 102s | +104% (V3 slower) |
| Turns | 11 | 26 | +136% |
| Output tokens | 2,973 | 4,721 | +59% |
| Input context (total) | 185,460 | 276,355 | +49% |
| Cache creation tokens | 21,659 | 52,302 | +142% |
| Cache read tokens | 163,793 | 224,040 | +37% |
| Ruflo MCP tool calls | 0 (not available) | 0 (server failed to connect) | — |
| Task completed | Yes | Yes | Tie |

**Note:** V3's higher cost is driven by the forced-tool-use prompt requiring Rom to search for claude-flow tools repeatedly, fail, document failures, then do the actual work with native tools. The overhead is entirely waste.

---

## 4. Output quality

The produced summary (`experiments/rag-ab/run-3/output.md`) is:

- **Accurate:** 8 lifecycle states correctly enumerated with owners and transitions
- **Complete:** All 7 state files documented with correct purposes
- **Useful:** Top 10 events by call-site frequency with context descriptions
- **Well-structured:** Clean markdown with tables, key invariants section

Assessment: **comparable to what an unaided Rom would produce** — because that's exactly what happened. The "forced Ruflo" prompt just added wasted turns searching for non-existent tools before falling back to the same native tools Rom always uses.

---

## 5. Verdict

**Ruflo's MCP tools add zero measurable value. Drop permanently.**

Three experiments across three different task types:

| Experiment | Task type | Ruflo tools loaded? | Ruflo tools invoked? | Outcome |
|-----------|-----------|-------------------|---------------------|---------|
| V1 (slice 282) | Code generation | Yes (237 tools) | No | Ignored — model preferred native tools |
| V2 (slice 284) | Cross-file retrieval | Yes (237 tools) | No | Ignored — model preferred native tools |
| V3 (slice 285) | Forced invocation | **No** (server didn't connect) | No | Server failure — tools unavailable |

**Root cause analysis:**

1. **V1/V2 — Tools present but ignored:** Claude's native Read/Grep/Glob/Write tools are strictly superior for this codebase size. The 237 claude-flow tools add ~26K tokens of context overhead with no compensating benefit. The model rationally avoids them.

2. **V3 — Server failed to connect:** The `npx -y claude-flow@latest mcp start` command either timed out during startup or failed silently. This reveals a reliability problem on top of the usefulness problem.

**Conclusion:** Ruflo-RAG fails on both axes that matter:
- **Usefulness:** When tools load, the model doesn't use them (V1, V2)
- **Reliability:** Tools don't reliably load (V3)

**Recommendation:** Remove `mcp-ruflo.json` from all configurations. Do not invest further in Ruflo-RAG integration. The A/B series is complete. If claude-flow MCP matures to the point where its tools offer capabilities native tools lack (e.g., persistent vector search across sessions, multi-agent coordination), revisit — but that's a different product than what ships today.
