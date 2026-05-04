---
id: "286"
title: "W-Ruflo-Learnings — Consolidated learnings from the Ruflo investigation"
from: rom
to: nog
status: DONE
slice_id: "286"
branch: "slice/286"
completed: "2026-05-04T11:52:30.000Z"
tokens_in: 95000
tokens_out: 4200
elapsed_ms: 180000
estimated_human_hours: 1.5
compaction_occurred: false
---

# DONE Report — W-Ruflo-Learnings (slice 286)

## What was done

Synthesized the four Ruflo investigation findings docs (slices 277, 282, 284, 285) into a single consolidated `docs/ruflo/LEARNINGS.md`.

## Deliverable

`docs/ruflo/LEARNINGS.md` — 7 sections as specified in the brief:

1. **TL;DR** — One paragraph summary. Verdict: drop Ruflo, proxy approach still alive for Sisko.
2. **What Ruflo actually is** — Two-sentence characterization as orchestration platform, not CLI replacement. Architecture chain referenced.
3. **What we tested** — Table of three experiments (V1/V2/V3) with hypothesis, setup, and result per row.
4. **Why we conclude drop Ruflo** — Four converging findings: tools ignored, MCP unreliable, no quality improvement, cost savings were artifacts.
5. **What's still alive** — Proxy approach (`ANTHROPIC_BASE_URL` → LiteLLM/OpenRouter), env-var change not CLI swap, Sisko owns scoping.
6. **Process learnings** — Probe-before-swap pattern; MCP availability ≠ tool usability.
7. **What this doc does NOT cover** — Other Ruflo plugins, interactive use, proxy cost numbers.

## Acceptance criteria status

| Criterion | Status |
|---|---|
| `docs/ruflo/LEARNINGS.md` exists with all 7 sections | Done |
| Four prior findings docs referenced/linked, not duplicated | Done — relative markdown links to all four |
| TL;DR is one paragraph | Done |
| Verdict is unambiguous: drop Ruflo-RAG, pursue proxy if Sisko approves | Done |
| No production code changes | Done — pure documentation |

## Files changed

- `docs/ruflo/LEARNINGS.md` (new) — consolidated learnings document
- `bridge/queue/286-DONE.md` (new) — this report
