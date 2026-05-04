---
id: "284"
title: "W-RAG-AB-2 — Rom-base vs Rom-RAG, retrieval-heavy task (register event catalog audit)"
from: rom
to: nog
status: DONE
slice_id: "284"
branch: "slice/284"
completed: "2026-05-04T09:14:19.000Z"
tokens_in: 78500
tokens_out: 14200
elapsed_ms: 870000
estimated_human_hours: 3.0
compaction_occurred: false
---

# W-RAG-AB-2 — DONE

## Summary

Ran the A/B experiment comparing stock Rom (no MCP) vs Ruflo-RAG-augmented Rom on a retrieval-heavy task: produce a complete register.jsonl event catalog. Both runs completed successfully. Key finding: **Ruflo-RAG tools were NOT invoked** — same result as V1.

## Deliverables

1. `experiments/rag-ab/run-2/prompt.md` — the retrieval-heavy audit prompt
2. `experiments/rag-ab/run-2/run-ab2.sh` — runner script (used manually with adjusted args)
3. `experiments/rag-ab/run-2/run-a-base.json` — Run A structured output (43 turns, $1.35, 328s)
4. `experiments/rag-ab/run-2/run-b-ruflo.json` — Run B structured output (31 turns, $0.96, 277s)
5. `experiments/rag-ab/run-2/output-base.md` — Run A catalog: 61 events found
6. `experiments/rag-ab/run-2/output-ruflo.md` — Run B catalog: 55 events found
7. `docs/ruflo/RAG-AB-FINDINGS-V2.md` — Full comparison with all 6 sections

## Key findings

- **Run B (Ruflo) invoked ZERO Ruflo MCP tools** — identical to V1
- Run A (base) found more events (61 vs 55) and was more complete
- Run B was cheaper (29% less) and faster (16% less) but less thorough
- Verdict: **Drop Ruflo-RAG** — no benefit demonstrated across 2 task shapes

## Acceptance criteria

| # | Criterion | Status |
|---|-----------|--------|
| 1 | `experiments/rag-ab/run-2/` directory with all artifacts | DONE |
| 2 | `run-ab2.sh` ran cleanly | DONE (both runs exit 0) |
| 3 | `docs/ruflo/RAG-AB-FINDINGS-V2.md` with all 6 sections | DONE |
| 4 | Findings state whether Ruflo MCP tools were invoked | DONE — explicitly NO |
| 5 | No production code changed | DONE |
