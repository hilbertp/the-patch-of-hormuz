---
id: "282"
title: "W-RAG-AB-1 — Rom-base vs Rom-with-Ruflo-RAG A/B probe"
from: rom
to: nog
status: DONE
slice_id: "282"
branch: "slice/282"
completed: "2026-05-04T01:16:00.000Z"
tokens_in: 42000
tokens_out: 4800
elapsed_ms: 300000
estimated_human_hours: 2.0
compaction_occurred: false
---

# 282-DONE: W-RAG-AB-1 — Rom-base vs Rom-with-Ruflo-RAG A/B probe

## Summary

Ran a controlled A/B experiment comparing base Claude Code (`claude -p` with no MCP) against Claude Code augmented with Ruflo's RAG MCP server (via `claude-flow@latest`). Both runs executed the same `gate-history.js` implementation prompt. Both succeeded, producing nearly identical high-quality output. **Ruflo's RAG tools were never invoked** — the MCP server loaded 237 tool definitions but Claude chose not to use any.

## Verdict

**Inconclusive — re-test with a different task type.** The chosen task (write a module from a detailed spec) doesn't exercise RAG retrieval. A multi-file refactor or cross-codebase search task would better test RAG value.

## Deliverables

| File | Status |
|---|---|
| `experiments/rag-ab/.gitignore` | Created |
| `experiments/rag-ab/mcp-base.json` | Created |
| `experiments/rag-ab/mcp-ruflo.json` | Created |
| `experiments/rag-ab/prompt.md` | Created |
| `experiments/rag-ab/run-ab.sh` | Created (executable) |
| `experiments/rag-ab/run-a-base.json` | Captured (Run A JSON output) |
| `experiments/rag-ab/run-a-base.stderr` | Captured |
| `experiments/rag-ab/run-a-output.js` | Captured (Run A gate-history.js) |
| `experiments/rag-ab/run-a-output.test.js` | Captured (Run A test) |
| `experiments/rag-ab/run-b-ruflo.json` | Captured (Run B JSON output) |
| `experiments/rag-ab/run-b-ruflo.stderr` | Captured |
| `experiments/rag-ab/run-b-output.js` | Captured (Run B gate-history.js) |
| `experiments/rag-ab/run-b-output.test.js` | Captured (Run B test) |
| `docs/ruflo/RAG-AB-FINDINGS.md` | Created (7 sections, verdict: inconclusive) |

## Key Numbers

| Metric | Run A (base) | Run B (Ruflo) |
|---|---|---|
| Cost | $0.292 | $0.226 |
| Wall time | 50s | 47s |
| Output tokens | 2,973 | 2,479 |
| Ruflo tool calls | n/a | 0 |
| Quality | Pass | Pass |

## Acceptance Criteria

1. `experiments/rag-ab/` exists with all five setup files — **PASS**
2. `run-ab.sh` executable, both runs produced JSON + module + test — **PASS**
3. All four output files captured — **PASS**
4. `docs/ruflo/RAG-AB-FINDINGS.md` with all 7 sections — **PASS**
5. No changes to `bridge/orchestrator.js` or `.claude/settings.json` — **PASS**
6. `bridge/state/gate-history.js` not committed (probe artifact cleaned) — **PASS**

## Notes

- The brief specified `--permission-mode bypassPermissions` but the flag is actually `--dangerously-skip-permissions`. Used `--permission-mode bypassPermissions` as written and it worked.
- Run B's apparent cost savings (−22%) is a cache-warming confound from running sequentially, not a RAG benefit.
- The run-ab.sh script was updated to pipe prompt via stdin (positional arg was misinterpreted as file path by `claude -p`).
