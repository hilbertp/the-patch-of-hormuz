---
id: "290"
title: "W-Ruflo-Fix-4 — G4-Nog: RAG over past Nog verdicts"
from: rom
to: nog
status: BLOCKED
slice_id: "290"
branch: "slice/290"
completed: "2026-05-04T20:20:00.000Z"
tokens_in: 45000
tokens_out: 8000
elapsed_ms: 300000
estimated_human_hours: 1.0
compaction_occurred: false
---

# W-Ruflo-Fix-4 — G4-Nog: RAG over past Nog verdicts

## Status: BLOCKED

Experiment cannot be executed as designed. Three independent blockers prevent any A/B run.

## Blockers

### 1. No verdict data exists

`bridge/register.jsonl` does not exist. Searched all JSONL files in `bridge/` — zero `NOG_DECISION` events found. The brief requires 50+ past verdicts; none are available.

### 2. Ruflo vector memory is non-functional

W-Ruflo-Fix-1 through Fix-3 established:
- Model ignores all 237 Ruflo MCP tools (0 invocations across 4 A/B experiments)
- Hooks broken due to upstream packaging bug (marketplace root vs per-plugin directory)
- Only measurable Ruflo effect: +163% cost with byte-identical output (Fix-3)

### 3. RAG premise invalidated

Even with data and working tools, the model has demonstrated zero willingness to invoke Ruflo retrieval tools during real tasks. The RAG pathway this experiment depends on does not function.

## What was done

- Created `experiments/g4-nog/README.md` documenting all three blockers
- Created `docs/ruflo/G4-NOG-RAG-FINDINGS.md` with cumulative evidence table (V1–V4 + G4-Nog)
- Verified absence of verdict data across all bridge JSONL files
- Cross-referenced Fix-1, Fix-2, Fix-3 findings to confirm dependency chain is broken at every link

## Acceptance criteria assessment

| Criterion | Status |
|---|---|
| Prerequisites (Fix-1, Fix-2) merged | Yes, but they found Ruflo non-functional |
| `experiments/g4-nog/` exists with both runs | Directory exists; runs not possible (BLOCKED) |
| Findings doc names a verdict | Yes: BLOCKED, with recommendation to drop |
| No production code changed | Correct — no production code touched |

## Recommendation

Drop the G4-Nog experiment. If Nog review consistency matters, investigate prompt engineering or few-shot examples injected directly into the Nog prompt — approaches that don't depend on broken third-party tooling.

## Files created

- `experiments/g4-nog/README.md`
- `docs/ruflo/G4-NOG-RAG-FINDINGS.md`
- `bridge/queue/290-DONE.md`
