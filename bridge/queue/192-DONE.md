---
id: "192"
title: "F-192 — ADR: orchestrator refactor + watcher deprecation + PARKED elimination"
from: rom
to: nog
status: DONE
slice_id: "192"
branch: "slice/192"
completed: "2026-04-23T10:15:00.000Z"
tokens_in: 185000
tokens_out: 9800
elapsed_ms: 5580000
estimated_human_hours: 3.5
compaction_occurred: false
---

## Summary

Design-only slice. Authored ADR 0001 defining the three-cut refactor plan for `bridge/orchestrator.js`. Key finding: `watcher.js` was already renamed to `orchestrator.js` in slice 176 — the "watcher deprecation" is complete at the file level. The ADR focuses on splitting the 4,716-line monolith into 12 modules under `bridge/relay/`, eliminating the PARKED intermediate file via Path A, and sequencing three follow-on slices (193–195).

## Work completed

- [x] Surveyed orchestrator.js: 24 named concerns, 4716 LOC — full responsibility table in ADR §1
- [x] Confirmed watcher.js does not exist (renamed in slice 176); no file to delete
- [x] Drafted ADR at `docs/adr/0001-orchestrator-refactor-and-watcher-deprecation.md`
- [x] Decided PARKED elimination: **Path A** — Rom embeds spec in DONE report; Nog reads from DONE
- [x] Defined 12-module `bridge/relay/` layout with LOC estimates (all ≤600)
- [x] Sequenced slices 193 (dead-code deletion, −180 LOC), 194 (mechanical split), 195 (PARKED elimination)
- [x] Wrote memory entry at `.auto-memory/project_orchestrator_refactor_adr.md`
- [x] Updated `.auto-memory/MEMORY.md` index

## Key decisions

**PARKED → Path A:** The PARKED file (created at orchestrator.js:2211) is eliminated by having Rom embed the original slice spec in a `## Original Specification` section of the DONE report. Nog reads from DONE directly. The PARKED poll gate (L4122–4128) and the PARKED read in `invokeNog` (L2421–2428) are both removed in slice 195. Path B (accumulating file) and Path C (read from git) were considered and rejected — rationale in ADR §4.

**Watcher deprecation:** Already done (slice 176). In slice 194, `orchestrator.js` becomes a 3-line shim requiring `./relay/index.js`, completing the conceptual consolidation.

**Dead code first (slice 193):** FUSE-safe checkout functions at L843–1017 are marked "DEPRECATED—worktree model obsoletes this" in the file's own comments. Deleting them before the split keeps git.js under the 600 LOC target.

## ADR location

`docs/adr/0001-orchestrator-refactor-and-watcher-deprecation.md`

10 line-number citations from orchestrator.js are embedded in ADR §7 as required evidence.

## Acceptance criteria check

- [x] AC 0: DONE skeleton committed as first commit on slice/192 ✓
- [x] AC 1: `docs/adr/0001-orchestrator-refactor-and-watcher-deprecation.md` created ✓
- [x] AC 2: ADR has all 6 sections (Survey, Module boundaries, Watcher deprecation, PARKED elimination, Backwards compat, Slice sequence) ✓
- [x] AC 3: Executive summary present (first section, ~15 lines) ✓
- [x] AC 4: ≥5 line-number citations — 10 cited in ADR §7 ✓
- [x] AC 5: PARKED path decided (Path A), alternatives in §4 with rejections ✓
- [x] AC 6: Slice sequence lists 3 slices (193, 194, 195), none exceeding 600 LOC net diff ✓
- [x] AC 7: Zero code changes under `bridge/`, `dashboard/`, `scripts/` ✓
- [x] AC 8: `.auto-memory/MEMORY.md` updated, `.auto-memory/project_orchestrator_refactor_adr.md` written ✓
- [x] AC 9: Total diff ≈350 LOC (ADR ~290 + DONE ~80 + memory ~25) — under 600 ✓

## Notes

No blockers. The ADR is opinionated: Path A is chosen, the module layout is specified with LOC budgets, and slices 193–195 each have a single-line goal derivable from the ADR alone. Philipp can orient from the executive summary in under 60 seconds.
