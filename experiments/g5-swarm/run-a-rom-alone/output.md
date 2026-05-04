# Run A — Rom-alone Output

Task: 3-phase audit of experiment directories (reader/writer/tester decomposition)

## Phase 1: File Inventory

Cataloged 5 experiment directories with 130+ files:
- `experiments/ruflo-probe/` — 18 probe files (claude-flow + agentic-flow CLI surface audit)
- `experiments/rag-ab/` — 4 runs (V1-V4), each with JSON/stderr/prompt/output artifacts
- `experiments/ruflo-fix-1/` — reproduce.sh + 5 timed runs + findings
- `experiments/ruflo-fix-2/` — findings + debug log + headless output
- `experiments/g4-nog/` — README.md only (BLOCKED)

## Phase 2: Consolidated Metrics

| Experiment | Slice | Tool Calls | Cost vs Control | Quality |
|---|---|---|---|---|
| V1 code-gen | 282 | 0 | -22% (cache) | Identical |
| V2 retrieval | 284 | 0 | -29% (fewer turns) | -10% completeness |
| V3 forced | 285 | 0 (MCP failed) | +91% | Fallback to native |
| V4 refactor | 289 | 0 | +163% | Byte-identical |

## Phase 3: Validation

All 8 findings docs in docs/ruflo/ have corresponding experiments/ directories. Zero mismatches.

## Execution Metrics

- Method: Single Claude Code agent (Explore subagent)
- Phases: All 3 completed in one pass
- Wall time: ~45 seconds
- Tool calls: Read + Glob + Grep (native tools only)
- Quality: Complete — all directories audited, all docs cross-referenced, zero gaps found
