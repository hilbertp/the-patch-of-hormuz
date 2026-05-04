---
id: "291"
title: "W-Ruflo-Fix-5 — G5: swarm coordination vs Rom-alone"
from: rom
to: nog
status: DONE
slice_id: "291"
branch: "slice/291"
completed: "2026-05-04T20:35:00.000Z"
tokens_in: 85000
tokens_out: 12000
elapsed_ms: 420000
estimated_human_hours: 2.0
compaction_occurred: false
---

## Summary

Ran the G5 swarm experiment: Ruflo swarm topology (reader/writer/tester) vs Rom-alone on a moderately complex 3-phase audit task. Result: **swarm produces zero output; Rom-alone completes in ~45 seconds with full accuracy.**

## What was done

1. **Created `experiments/g5-swarm/`** with task definition, Run A (Rom-alone), and Run B (swarm) directories.

2. **Run B (swarm):** Attempted full Ruflo swarm execution path:
   - `ruflo swarm init --v3-mode` — created swarm ID, printed topology table
   - `ruflo swarm start` — printed 8-agent deployment plan, zero agents active
   - `ruflo swarm status` — confirmed 0 active, 0 tasks, 0 output
   - `ruflo swarm coordinate --agents 3` — created 3 agent slots, no execution
   - `ruflo hive-mind spawn --claude` — launched `claude -p` with prompt referencing non-existent `mcp__ruflo__*` tools; spawned agent exited immediately
   - **Result: 0 phases completed, 0 output produced**

3. **Run A (Rom-alone):** Single Explore subagent completed all 3 phases:
   - Phase 1 (reader): cataloged 130+ files across 5 experiment directories
   - Phase 2 (writer): produced consolidated metrics table across V1-V4 + G4
   - Phase 3 (tester): validated all 8 findings docs have matching experiment dirs (0 mismatches)
   - **Result: 3/3 phases completed, ~45 seconds, full accuracy**

4. **Wrote findings:** `docs/ruflo/G5-SWARM-FINDINGS.md` with full metrics, root cause analysis, and verdict.

## Verdict

**Drop swarm.** No complexity threshold exists because the swarm cannot execute at all. The execution gap is fundamental: Ruflo creates metadata (IDs, topologies, agent slots) but spawned agents have no access to the `mcp__ruflo__*` tools referenced in coordination prompts. Same root cause as V3 (slice 285) and Fix-2 (slice 288).

## Recommendation

Close the Ruflo investigation entirely. Six generations (G1-G5) converge on the same conclusion: Ruflo adds cost and complexity with zero measurable benefit. Pursue Bet-2 cost-routing via `ANTHROPIC_BASE_URL` proxy independently.

## Files created/modified

- `experiments/g5-swarm/TASK.md` — task definition
- `experiments/g5-swarm/run-a-rom-alone/output.md` — Run A results
- `experiments/g5-swarm/run-b-swarm/output.md` — Run B results
- `experiments/g5-swarm/run-b-swarm/swarm-init.log` — swarm init output
- `experiments/g5-swarm/run-b-swarm/swarm-start.log` — swarm start output
- `experiments/g5-swarm/run-b-swarm/swarm-status.log` — status check
- `experiments/g5-swarm/run-b-swarm/swarm-coordinate.log` — coordinate output
- `experiments/g5-swarm/run-b-swarm/hive-spawn.log` — hive-mind spawn output
- `experiments/g5-swarm/run-b-swarm/hive-mind-prompt.txt` — generated prompt (references non-existent tools)
- `docs/ruflo/G5-SWARM-FINDINGS.md` — findings document with verdict
- `bridge/queue/291-DONE.md` — this report
