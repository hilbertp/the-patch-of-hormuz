---
id: "026"
title: "Relay-invoked commission evaluator"
goal: "DONE reports are automatically evaluated in the relay without Cowork involvement, completing the autonomous delivery loop."
from: kira
to: obrien
priority: spike
created: "2026-04-09T02:42:00Z"
references: null
timeout_min: null
---

## Objective

Implement the relay-invoked commission evaluator inside `bridge/watcher.js`. This evaluator runs after O'Brien finishes a commission (writes DONE), automatically evaluates it against the original acceptance criteria, and determines whether to ACCEPT, write an AMENDMENT, or mark it STUCK. This replaces the `kira-commission-watch` Cowork task which was causing critical storage harm.

## Context

The `kira-commission-watch` Cowork scheduled task (every 1 minute) was disabled 2026-04-09 due to storage bleed. We now need evaluation logic built into the relay itself as an always-on, autonomous process.

Dax has completed the architecture: `/repo/.claude/roles/kira/RESPONSE-EVALUATOR-ARCHITECTURE-FROM-DAX.md`. This commission translates that design into implementation tasks.

Key context files:
- Dax's ADR: `repo/.claude/roles/kira/RESPONSE-EVALUATOR-ARCHITECTURE-FROM-DAX.md` (full design)
- Current watcher: `bridge/watcher.js` — reference `invokeOBrien()` pattern (lines ~620–700) and `registerEvent()` (lines ~750–800)
- Register format: `bridge/register.jsonl` (JSONL, one event per line)
- Commission format: `bridge/templates/commission.md` (required frontmatter: id, title, goal, from, to, priority, created, references, timeout_min)

## Tasks

1. **Extend the `poll()` function** to scan for DONE files after checking for PENDINGs. Evaluation is lower priority than incoming commissions.
   - If processing = true, return (avoid concurrent evaluations)
   - Scan `queue/` for `-DONE.md` files
   - For each DONE: check if it's a merge commission (skip evaluation), check if already reviewed (skip), otherwise rename to EVALUATING and invoke evaluator

2. **Implement `invokeEvaluator(id)` function** mirroring `invokeOBrien()`:
   - Read `{id}-COMMISSION.md` (original ACs from Kira's commission)
   - Read `{id}-EVALUATING.md` (O'Brien's DONE report)
   - Query `register.jsonl` to count REVIEWED events for this root commission (amendment cycle count)
   - Construct evaluator prompt per Dax's template (Section 3 of ADR)
   - Call `claude -p` with the prompt
   - Parse JSON response: `{ verdict, reason, failed_criteria, amendment_instructions }`
   - Set `processing = true` during execution, update heartbeat with `status: 'evaluating'`

3. **Handle ACCEPTED verdict**:
   - Write register event: `ACCEPTED` with reason and cycle number
   - Rename `{id}-EVALUATING.md` → `{id}-ACCEPTED.md`
   - Write merge commission `{next_id}-PENDING.md` with `type: merge`, `source_commission_id: {id}`, `branch: {branch_name}` (read from DONE frontmatter)
   - Call `POST /api/bridge/review` with `{ id, verdict: "ACCEPTED", reason }`

4. **Handle AMENDMENT_NEEDED verdict (cycle < 5)**:
   - Write register event: `REVIEWED` with verdict, reason, failed_criteria, cycle
   - Rename `{id}-EVALUATING.md` → `{id}-REVIEWED.md`
   - Write amendment commission `{next_id}-PENDING.md`:
     - Frontmatter: `root_commission_id: {id}`, `amendment_cycle: {n+1}`, `branch: {branch_name}`, `type: amendment`
     - Body: evaluator's amendment_instructions + reference to original ACs and what to fix
   - Call `POST /api/bridge/review` with `{ id, verdict: "AMENDMENT_NEEDED", reason }`

5. **Handle STUCK verdict (cycle ≥ 5)**:
   - Write register event: `STUCK` with reason and cycle count
   - Rename `{id}-EVALUATING.md` → `{id}-STUCK.md`
   - Do NOT write a new PENDING — commission is dead pending manual intervention
   - Call `POST /api/bridge/review` with `{ id, verdict: "STUCK", reason }`

6. **Merge commission auto-accept**: detect `type: merge` in COMMISSION frontmatter, skip evaluation, rename DONE → ACCEPTED, register ACCEPTED event. No `claude -p` call for merges.

7. **Crash recovery**: extend `crashRecovery()` to scan for orphaned `-EVALUATING.md` files and rename them back to DONE for re-evaluation on next poll.

8. **Heartbeat updates**: while evaluator is running, set heartbeat `status: 'evaluating'` and `current_commission: {id}`. On completion, reset to idle and increment `processed_total`.

9. **Branch name propagation**: read branch from O'Brien's DONE frontmatter, write it into amendment and merge commission frontmatter. This keeps amendments on the same branch across cycles.

10. **Commission ID sequencing**: use existing `nextCommissionId()` function (line ~870) to get next ID for amendments and merge commissions.

## Constraints

- Evaluator must run in the relay (`bridge/watcher.js` or a new file imported by watcher), not in Cowork. No Cowork cron, no Cowork sandbox.
- Must not run two `claude -p` calls concurrently. The existing `processing` flag must gate evaluation as it gates O'Brien invocation.
- Amendment cap is hard: 5 cycles max. No exceptions, no configuration override in this slice.
- Must call `POST /api/bridge/review` for all verdicts (ACCEPTED, AMENDMENT_NEEDED, STUCK). This endpoint already exists (commission 022).
- All register events must use existing `registerEvent()` function with correct event types: ACCEPTED, REVIEWED, STUCK.

## Success Criteria

- [ ] `poll()` function scans for DONE files after PENDINGs, handles merge auto-accept
- [ ] `invokeEvaluator()` function reads COMMISSION + EVALUATING, constructs prompt, calls `claude -p`, parses JSON response
- [ ] ACCEPTED verdict: register event written, file renamed, merge commission created, API call made
- [ ] AMENDMENT_NEEDED verdict: register event written, file renamed, amendment commission created with root_commission_id, cycle count, branch, ACs + fix instructions, API call made
- [ ] STUCK verdict: register event written, file renamed, no new PENDING, API call made
- [ ] Merge commissions skip evaluation entirely (auto-accept on DONE)
- [ ] Branch name correctly flows from DONE → amendment → merge through entire cycle
- [ ] Amendment cycle count correctly derived from register REVIEWED events
- [ ] Crash recovery extends to EVALUATING orphans
- [ ] Heartbeat reflects evaluator status (`status: 'evaluating'` during run, idle after)
- [ ] Evaluator tested end-to-end: commission 025 (currently DONE) is evaluated, verdict written, next commission (merge or amendment) appears in queue automatically
- [ ] All register events have correct event type, id, verdict, reason, failed_criteria (if applicable), cycle (if applicable)
- [ ] All new commissions (amendments, merges) have valid frontmatter per template: id, title, goal, from, to, priority, created, references, timeout_min

