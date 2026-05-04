# G4-Nog RAG Findings: BLOCKED

## TL;DR

Experiment cannot run. No verdict data exists (`register.jsonl` missing), Ruflo's
vector memory tools are non-functional (0/237 tools invoked across 4 prior A/B
tests), and hooks are broken due to upstream packaging bug. The question "does
RAG-Nog match human truth more often?" cannot be answered until these three
blockers are resolved.

## Setup — not possible

**Past verdicts:** `bridge/register.jsonl` does not exist. Searched all JSONL
files in `bridge/` — zero `NOG_DECISION` events found. The 50+ verdict
requirement cannot be met.

**Ruflo vector memory:** W-Ruflo-Fix-2 confirmed plugin install works headlessly
but hooks don't load (packaging bug: hooks at marketplace root, not per-plugin
directory). W-Ruflo-Fix-3 confirmed the model never invokes Ruflo tools even
when they're available — 0 tool calls across a full cross-file refactor task.

**Slice for A/B:** Moot without data or functional tooling.

## Run A (control) — not executed

N/A

## Run B (treatment) — not executed

N/A

## Verdict

**Cannot assess.** The experiment's core dependency chain is broken at every link:

| Dependency | Status | Evidence |
|---|---|---|
| 50+ Nog verdicts in register.jsonl | Missing | File does not exist |
| Ruflo vector memory ingestion | Non-functional | Fix-2: hooks broken |
| Ruflo tool invocation during review | Non-functional | Fix-3: 0 tool calls, +163% cost |

### Cumulative Ruflo evidence (V1–V4 + G4-Nog)

| Experiment | Ruflo tool calls | Cost delta | Outcome |
|---|---|---|---|
| V1 (code gen) | 0 | -22% (cache) | Identical output |
| V2 (retrieval) | 0 | -29% (cache) | -10% completeness |
| V3 (forced) | N/A (MCP failed) | +91% | Wasted turns |
| V4 (cross-file refactor) | 0 | +163% | Byte-identical output |
| G4-Nog (this) | N/A | N/A | BLOCKED × 3 |

**Recommendation:** Drop the G4-Nog experiment. The Ruflo RAG pathway it
depends on has been conclusively shown to be non-functional. If Nog review
consistency is a real concern, investigate prompt engineering or few-shot
examples injected directly into the Nog prompt — approaches that don't depend
on broken third-party tooling.
