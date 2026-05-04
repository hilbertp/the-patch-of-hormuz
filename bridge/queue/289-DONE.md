---
id: "289"
title: "W-Ruflo-Fix-3 — G3 v2: real retrieval-shaped task A/B with plugin install"
from: rom
to: nog
status: DONE
slice_id: "289"
branch: "slice/289"
completed: "2026-05-04T20:12:00.000Z"
tokens_in: 125000
tokens_out: 18000
elapsed_ms: 600000
estimated_human_hours: 3.0
compaction_occurred: false
---

# W-Ruflo-Fix-3 — DONE Report

## Summary

Ran a proper A/B comparison on a real retrieval-shaped task: cross-file rename of `registerEvent` to `appendSliceEvent` across 51 files / 230 call sites. Stock Claude Code vs Claude Code with Ruflo plugin installed (Fix-2 recipe) and MCP server pre-warmed (Fix-1 workaround).

## Key Results

**Ruflo loses decisively.** Both runs produced byte-identical diffs. Ruflo cost 2.6x more and took 35% longer. Zero Ruflo tools invoked. Zero hooks fired.

| Metric | Run A (stock) | Run B (Ruflo) | Delta |
|--------|--------------|---------------|-------|
| Wall time | 74s | 100s | +35% |
| Cost | $0.19 | $0.50 | +163% |
| Turns | 11 | 22 | +100% |
| Input tokens | 144K | 437K | +203% |
| Files changed | 51 | 51 | 0 |
| Output diff | — | byte-identical | — |
| Ruflo tool calls | N/A | 0 | — |
| Hook invocations | N/A | 0 | — |

## Prerequisites Confirmed

1. **Fix-1 (slice 287):** MCP pre-warm applied. claude-flow MCP server connected successfully (process confirmed running).
2. **Fix-2 (slice 288):** Plugin installed via `claude plugin install ruflo-core@ruflo --scope user`. Verified enabled. Hooks still broken (packaging bug).

## Acceptance Criteria

1. Both prerequisites merged before run — **MET** (slices 287, 288 on branch)
2. `experiments/rag-ab/run-4/` exists with both runs' artifacts — **MET**
3. Verdict explicitly answers the question — **MET** (Ruflo does not improve cross-file refactor quality; output is identical, cost is 2.6x higher)
4. Metrics include tool/hook invocation counts — **MET** (0 tool calls, 0 hooks)
5. No production code changed on main — **MET** (all refactor changes captured as diffs, reverted after each run)

## Deliverables

- `experiments/rag-ab/run-4/` — prompt, run-a/run-b JSON outputs, diffs, diffstats
- `docs/ruflo/RAG-AB-FINDINGS-V4.md` — full comparison with cumulative V1-V4 evidence table

## Cumulative Verdict

Four A/B experiments across three task types (code gen, retrieval scan, cross-file refactor) plus one forced invocation test all converge: **drop Ruflo**. The model prefers native tools, Ruflo's MCP tools are ignored, hooks are broken, and the only measurable effect is increased cost.
