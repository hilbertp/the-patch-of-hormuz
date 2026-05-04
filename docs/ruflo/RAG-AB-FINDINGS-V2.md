# RAG A/B Findings V2 — Rom-base vs Rom-with-Ruflo-RAG (retrieval-heavy task)

**Probe:** W-RAG-AB-2 (slice 284)
**Date:** 2026-05-04
**Task:** Produce a complete register.jsonl event catalog by scanning all emission sites across the codebase
**Prior:** [RAG-AB-FINDINGS.md](RAG-AB-FINDINGS.md) (V1, slice 282 — inconclusive, re-test recommended)

---

## 1. TL;DR

Ruflo-RAG lost this round on completeness and **still did not invoke any Ruflo MCP tools**. Run A (base, no Ruflo) found 61 events across 13 files. Run B (Ruflo-augmented) found 55 active events (+ 5 listed as "reserved but not emitted"), missed at least 6 events that Run A caught, yet cost 29% less ($0.96 vs $1.35) due to fewer turns. The RAG tools were available but entirely ignored — same behavior as V1. **Verdict: drop Ruflo-RAG.** Two experiments with tasks spanning code-generation and cross-file retrieval both show zero RAG tool invocation. The tools add context overhead without benefit.

---

## 2. Setup

- **What changed from V1:** Task switched from single-file code generation to a genuine retrieval task requiring scanning 6+ source files for all `registerEvent`/`emit` callsites.
- **Experiment directory:** `experiments/rag-ab/run-2/`
- **MCP configs:** Same as V1 — `mcp-base.json` (empty) and `mcp-ruflo.json` (claude-flow MCP server)
- **Prompt:** Audit all register.jsonl emission sites, produce markdown catalog with file:line, trigger, and payload shape
- **Model:** claude-opus-4-6[1m] (both runs, standard speed)
- **Permission mode:** bypassPermissions (both runs)
- **Run date:** 2026-05-04, sequential execution, same machine

---

## 3. Run A (base Rom — no Ruflo)

| Metric | Value |
|--------|-------|
| Duration | 328,103 ms (~5m 28s) |
| Turns | 43 |
| Tokens in (total context) | 30 direct + 53,146 cache creation + 1,018,253 cache read |
| Tokens out (Opus) | 11,838 |
| Haiku sub-agent tokens out | 7,312 |
| Cost (Opus) | $1.137 |
| Cost (Haiku) | $0.215 |
| **Total cost** | **$1.352** |
| Events found | **61** |
| Files scanned | 13 |
| Ruflo MCP tools invoked | N/A (not available) |

**Catalog quality:** Complete. Found all pipeline events from `orchestrator.js`, `git-finalizer.js`, `gate-mutex.js`, `branch-state-recovery.js`, `new-slice.js`, plus 5 Bashir-emitted events and `BACKFILL_ARCHIVE_COMPLETE`. File:line references provided for all 61 events. Trigger descriptions accurate. Payload fields comprehensive including optional fields.

---

## 4. Run B (Ruflo-augmented Rom)

| Metric | Value |
|--------|-------|
| Duration | 277,007 ms (~4m 37s) |
| Turns | 31 |
| Tokens in (total context) | 20 direct + 37,241 cache creation + 587,703 cache read |
| Tokens out (Opus) | 8,117 |
| Haiku sub-agent tokens out | 10,963 |
| Cost (Opus) | $0.730 |
| Cost (Haiku) | $0.226 |
| **Total cost** | **$0.955** |
| Events found | **55** (+ 5 "reserved but not emitted" = 60 awareness) |
| Files scanned | 13 |
| **Ruflo MCP tools invoked** | **0 — NONE** |

**Did Rom invoke any Ruflo MCP tools?** No. Zero tool-use traces referencing any Ruflo/claude-flow tool in the output JSON. The only "ruflo" string in the output is the filename `output-ruflo.md`. The MCP server was available but entirely ignored — identical to V1 behavior.

---

## 5. Catalog quality comparison

| Dimension | Run A (base) | Run B (ruflo) | Winner |
|-----------|-------------|---------------|--------|
| Event count | 61 | 55 active (60 with reserved) | **A** |
| Completeness vs ground truth | Found all events including `BACKFILL_ARCHIVE_COMPLETE` | Missed `BACKFILL_ARCHIVE_COMPLETE`, `NOG_INVOKED`, `ROM_ABORTED`, `ROM_ESCALATE`, `ROM_PAUSED`, `ROM_RESUMED` appear under different categorization | **A** |
| File:line accuracy | All 61 events have specific line numbers | All 55 events have line numbers | Tie |
| Trigger descriptions | Clear, one-sentence per event | Clear, one-sentence per event | Tie |
| Payload documentation | Comprehensive, includes optional flags | Good, some events marked "variable" | **A** (slight) |
| Structural organization | Single table + emission channels section | Split by writer type + separate VALID_EVENTS section | **B** (clearer architecture view) |
| Cost efficiency | $1.35 / 61 events = $0.022/event | $0.96 / 55 events = $0.017/event | **B** (cost) |

**Key gaps in Run B:**
- Missing `BACKFILL_ARCHIVE_COMPLETE` (orchestrator.js:5208)
- Counts 55 vs 61 because it excludes Bashir-emitted events from the main table, whereas Run A includes them with "(Bashir — external process)" attribution
- Run B's architectural separation (Writer A/B/C/D sections) is arguably better documentation but at the cost of completeness

---

## 6. Verdict

**Drop Ruflo-RAG.** Concrete recommendation:

- **Two experiments, zero RAG tool invocations.** V1 tested code generation, V2 tested cross-file retrieval. In neither case did Claude invoke any of the 237 claude-flow MCP tools. The tools are simply ignored.
- **RAG added no value.** Run B was cheaper (29% less) but also less complete (10% fewer events). The cost savings came from fewer turns/less thorough scanning — not from RAG efficiency.
- **Root cause hypothesis:** Claude's built-in Grep/Read/Glob tools are sufficient for this codebase size. The Ruflo MCP tools add 237 tool definitions to context (token overhead) without providing capabilities that native tools lack. The model has no reason to prefer them.
- **Recommendation:** Remove `mcp-ruflo.json` from any Rom configuration. Do not invest further in Ruflo-RAG integration unless the codebase grows to a scale where native tools demonstrably fail (estimated threshold: 500+ files or 100k+ LoC where grep becomes impractical).

**Numeric summary:**
| | Run A (base) | Run B (ruflo) | Delta |
|---|---|---|---|
| Cost | $1.352 | $0.955 | -29% (B cheaper) |
| Time | 328s | 277s | -16% (B faster) |
| Events found | 61 | 55 | -10% (A more complete) |
| RAG tools used | N/A | **0** | No benefit |
| Quality winner | **A** | — | A wins on completeness |
