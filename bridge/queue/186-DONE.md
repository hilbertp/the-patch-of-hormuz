---
id: "186"
title: "F-186 — Nog prompt flip to canonical verdict vocabulary (Dax-1b)"
from: rom
to: nog
status: DONE
slice_id: "186"
branch: "slice/186"
completed: "2026-04-22T16:42:00.000Z"
tokens_in: 18400
tokens_out: 2800
elapsed_ms: 600000
estimated_human_hours: 0.25
compaction_occurred: false
---

## Summary

Flipped Nog's prompt and role definition from legacy `PASS`/`RETURN` vocabulary to canonical four-verdict rubric: `ACCEPTED`, `REJECTED`, `ESCALATE`, `OVERSIZED`. Producer-side half of the Dax-1a/1c protocol split is now complete.

## Changes

### bridge/nog-prompt.js
Replaced line 42's single-line `verdict: PASS` / `verdict: RETURN` format instruction with a four-line rubric:
- `ACCEPTED` — all ACs met, quality bar cleared
- `REJECTED` — one or more ACs unmet or quality issues found; rework needed
- `ESCALATE` — ACs contradictory, impossible, or require scope change; needs O'Brien
- `OVERSIZED` — diff too large or scope exceeded; slice must be split

### .claude/roles/nog/ROLE.md
Updated all verdict-context references from legacy to canonical:
- Identity section verdict list: PASS/RETURN/ESCALATE → ACCEPTED/REJECTED/ESCALATE/OVERSIZED
- Gate 1 and Gate 2 verdict statements: RETURN → REJECTED
- Slice annotation format: `PASS | RETURN | ESCALATE` → `ACCEPTED | REJECTED | ESCALATE | OVERSIZED`
- "If verdict is PASS" → "If verdict is ACCEPTED"
- Verdicts table: updated all rows, added OVERSIZED row
- Invocation section: updated verdict list
- Anti-patterns section: updated RETURN/ESCALATE references

### test/nog-prompt-vocabulary.test.js (new)
Regression test asserting:
- Prompt contains `ACCEPTED`, `REJECTED`, `ESCALATE`, `OVERSIZED`
- Prompt does NOT contain `verdict: PASS` or `verdict: RETURN` (regex scoped to verdict-context only)

## ACs

- AC 0: DONE — skeleton committed on `slice/186` (prior session).
- AC 1: DONE — `bridge/nog-prompt.js` contains canonical verdict vocabulary only.
- AC 2: DONE — `grep -nE "verdict:\s*(PASS|RETURN)" bridge/nog-prompt.js` returns nothing.
- AC 3: DONE — `.claude/roles/nog/ROLE.md` updated; no remaining legacy verdict terms.
- AC 4: DONE — `bridge/lifecycle-translate.js` byte-identical to main (untouched).
- AC 5: DONE — `bridge/orchestrator.js` byte-identical to main (untouched). `translateVerdict` confirmed at line 3170 — precondition met.
- AC 6: DONE — Regression test passes; all four canonical verbs present, no legacy verdict literals.
- AC 7: DONE — Full test suite passes (10 test files, all green).
- AC 8: DONE — `bridge/register.jsonl` does not exist in this worktree; no append-only concern. `bridge/trash/` and all `-ARCHIVED.md` untouched.
- AC 9: DONE — Non-test diff is 17 LOC (well under 80).

## Notes

- The Linting annotation format `**Linting:** PASS | FAIL` in ROLE.md was intentionally preserved — `PASS`/`FAIL` there refer to linting status, not Nog verdicts.
- `bridge/lifecycle-translate.js` dual-accept paths preserved; no legacy paths removed. Consumer side still tolerates legacy vocab via `translateVerdict` for any in-flight Nog sessions.
