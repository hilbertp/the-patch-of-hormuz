# RAG A/B Findings — Rom-base vs Rom-with-Ruflo-RAG

**Probe:** W-RAG-AB-1 (slice 282)
**Date:** 2026-05-04
**Task:** `gate-history.js` module + test (single-shot code generation)

---

## 1. TL;DR

Ruflo-RAG did **not** win. Both runs produced functionally identical, high-quality output. Run B (Ruflo) was marginally cheaper ($0.226 vs $0.292) and slightly faster (47s vs 50s), but this is attributable to prompt caching variance, not RAG benefit — Run B did not invoke any Ruflo MCP tools during execution. The claude-flow MCP server loaded its 237 tool definitions into context but Claude never called any of them. **Verdict: inconclusive — re-test with a task that requires codebase knowledge retrieval** (e.g., a multi-file refactor or a "find all callers of X" task where RAG indexing would plausibly help).

---

## 2. Setup

- **Experiment directory:** `experiments/rag-ab/`
- **Probe config:** Two MCP configs — `mcp-base.json` (empty) and `mcp-ruflo.json` (claude-flow MCP server)
- **Prompt:** Create `bridge/state/gate-history.js` + `bridge/test/state-gate-history.test.js` matching existing codebase conventions
- **Model:** claude-opus-4-6[1m] for both runs
- **Permission mode:** bypassPermissions (both runs)
- **Run date:** 2026-05-04, sequential execution, same machine

---

## 3. Run A (base Rom)

- **Tokens in:** 8 direct + 21,659 cache creation + 163,793 cache read = **185,460 total input context**
- **Tokens out:** 2,973
- **Cost:** $0.2916
- **Wall time:** 49,972 ms (~50s)
- **Turns:** 11
- **Exit:** success, `end_turn`
- **Output quality:**
  - `gate-history.js`: 41 lines, `'use strict'`, correct `module.exports` shape, `path.resolve(__dirname, '..', 'register.jsonl')`, ENOENT handling, malformed-line resilience. Matches sibling module patterns.
  - Test: 6 tests covering missing file, empty file, filtering, limit, fewer-than-limit, malformed JSON. Uses backup/restore pattern for register.jsonl. Imports `os` and `node:test`. Slightly more complex fixture setup than needed.
  - **Assessment:** Matches existing patterns. Correct and complete.

---

## 4. Run B (Ruflo-RAG Rom)

- **Tokens in:** 9 direct + 10,088 cache creation + 201,320 cache read = **211,417 total input context**
- **Tokens out:** 2,479
- **Cost:** $0.2257
- **Wall time:** 47,343 ms (~47s)
- **Turns:** 11
- **Exit:** success, `end_turn`
- **Ruflo MCP tool invocations:** **0** — no tool-use traces in stderr. The MCP server was loaded (contributing ~25K additional cache-read tokens from tool definitions) but Claude did not call any Ruflo tools.
- **Output quality:**
  - `gate-history.js`: 39 lines, nearly identical to Run A. Same structure, same logic, same error handling. Minor wording difference in JSDoc comment.
  - Test: 6 tests, cleaner structure than Run A (no `os` import, direct destructured import of `getRecentGateEvents`, simpler fixture helpers). Tests the default-50-limit explicitly.
  - **Assessment:** Matches existing patterns. Correct and complete. Marginally cleaner test file.

---

## 5. Comparison Table

| Metric | A (base) | B (Ruflo-RAG) | Delta |
|---|---|---|---|
| Direct input tokens | 8 | 9 | +1 |
| Cache creation tokens | 21,659 | 10,088 | -11,571 |
| Cache read tokens | 163,793 | 201,320 | +37,527 |
| Total input context | 185,460 | 211,417 | +25,957 (Ruflo tool defs) |
| Output tokens | 2,973 | 2,479 | -494 |
| Cost (USD) | $0.2916 | $0.2257 | -$0.066 (−22%) |
| Wall time (ms) | 49,972 | 47,343 | -2,629 (−5%) |
| Turns | 11 | 11 | 0 |
| Ruflo tool calls | n/a | 0 | — |
| Output matches patterns | Yes | Yes | Tie |
| Tests reported passing | Yes (6/6) | Yes (6/6) | Tie |

**Note on cost delta:** Run B's lower cost is due to cache-read pricing dynamics (more tokens hit cache), not RAG benefit. Run B ran second, so more of the base context was already cached from Run A. This is a confound, not a signal.

---

## 6. Verdict

**Ruflo loses (inconclusive) — re-test with a different task.**

The >20% cost improvement threshold is technically met ($0.066 savings = −22%), but this is entirely attributable to prompt cache warming from Run A, not Ruflo RAG. The Ruflo MCP server loaded 237 tools into context (adding ~26K tokens to context window) and Claude used **none** of them. Both runs produced equivalent output in equivalent time with equivalent quality.

The test task (write a single module from a detailed spec) doesn't benefit from RAG retrieval — Claude already has the full codebase in its context window via CLAUDE.md autodiscovery and file reads. RAG would need to demonstrate value on tasks where:
- The codebase is too large to fit in context
- The task requires finding non-obvious code relationships
- Pattern matching across many files is needed

**Recommendation:** Re-test with a multi-file refactor task (e.g., "rename all usages of X across the codebase") or a "find and fix all callers" task where RAG indexing could plausibly outperform linear file reads. If Ruflo still doesn't invoke its own tools, drop it.

---

## 7. What This Did NOT Determine

- **Multi-cycle effects:** Whether Ruflo's vector memory improves over multiple slice iterations (the RAG index gets richer over time). This was a one-shot probe.
- **Cost routing:** Whether Ruflo's cost routing features reduce spend on longer tasks. Not tested.
- **Large-codebase benefit:** Whether RAG helps when the codebase exceeds context window limits. Our codebase fits comfortably in 1M context.
- **Indexing overhead:** Whether pre-indexing the codebase into Ruflo's RAG store changes results. We used cold-start (no pre-indexing).
- **Other Ruflo capabilities:** Vector memory persistence, multi-agent coordination, cost tracking. Single-capability probe only.
- **Statistical significance:** n=1 per condition. Cache confounds between sequential runs. A proper test would need randomized ordering, multiple runs, and independent worktrees.
