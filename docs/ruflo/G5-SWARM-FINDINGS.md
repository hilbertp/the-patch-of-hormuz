# G5 — Swarm Coordination vs Rom-Alone

**Slice:** 291 (W-Ruflo-Fix-5)
**Date:** 2026-05-04
**Status:** Complete. Verdict: drop swarm. Rom-alone wins on every dimension.

---

## 1. TL;DR

Ruflo's swarm coordination cannot execute work. The `swarm start` and `hive-mind spawn --claude` commands create state-management scaffolding (IDs, topologies, agent slots) but never produce output. The spawned Claude instance receives a prompt referencing `mcp__ruflo__*` tools that don't exist in its environment and exits immediately. Meanwhile, Rom-alone completed the same 3-phase task (read/write/test) in ~45 seconds with full accuracy. Swarm overhead was 100% — every token spent on swarm coordination was wasted.

**Verdict: Drop swarm.** There is no complexity threshold at which the swarm topology becomes viable, because the swarm cannot execute at all.

---

## 2. Setup

**Task chosen:** Audit all experiment directories for consistency, produce a consolidated metrics summary, and validate cross-references between docs/ruflo/ findings and experiments/ directories. This task has three naturally decomposable phases (reader, writer, tester) and requires scanning 5 directories + 8 findings docs — complex enough to plausibly benefit from parallelism.

**Swarm topology:** Ruflo v3.6.27 hierarchical-mesh, configured via:
- `ruflo swarm init --v3-mode` (15-agent capacity)
- `ruflo swarm start -o "<task>" -s development` (8 agent slots: coordinator, architect, 3 coders, 2 testers, reviewer)
- `ruflo swarm coordinate --agents 3` (3-agent subset)
- `ruflo hive-mind spawn --claude` (attempted Claude Code execution)

**Control:** Single Claude Code agent (Explore subagent via Agent tool).

---

## 3. Run A — Rom-Alone Metrics

| Metric | Value |
|---|---|
| Wall time | ~45 seconds |
| Phases completed | 3/3 (reader, writer, tester) |
| Files audited | 130+ across 5 experiment dirs |
| Docs cross-referenced | 8 findings docs |
| Mismatches found | 0 (clean audit) |
| Tool calls | Native Read/Glob/Grep only |
| Cost | Single agent invocation |
| Accepted round 1? | Yes — complete and correct output |

---

## 4. Run B — Swarm Metrics

| Metric | Value |
|---|---|
| Wall time | ~120 seconds (init + start + coordinate + hive-mind) |
| Phases completed | **0/3** |
| Agents spawned | 1 (of 8 planned) |
| Agent output | **None** — exited immediately |
| MCP tools available | **0** (prompt referenced 20+ non-existent tools) |
| Tasks created | **0** |
| Cost | Wasted on swarm init/start/coordinate ceremony |
| Accepted round 1? | **No** — zero output produced |

### Swarm execution timeline

1. **`swarm init`** — Created swarm ID, printed topology table. No agents spawned.
2. **`swarm start`** — Printed deployment plan (8 slots). Zero agents active. Zero tasks. "Initialized via MCP" — but MCP server has no connected consumers.
3. **`swarm status`** — Confirmed: 0 active, 0 idle, 0 completed, 0 tasks. "Tokens Used: unknown."
4. **`swarm coordinate`** — Created 3 "agent slots" (Queen + 2 Security). Note in output: "Use Claude Code Task tool or hive-mind spawn --claude to drive actual agent execution." Coordination ≠ execution.
5. **`hive-mind spawn --claude`** — Spawned 1 worker. Launched `claude -p` with a prompt referencing `mcp__ruflo__*` tools. The spawned Claude recognized none of these tools exist and exited without producing output. The `-n 3` flag was misinterpreted as objective "3" (not agent count).

### Root cause: swarm is scaffolding, not execution

Ruflo's swarm commands manage *metadata* — agent slots, topology graphs, consensus protocols, memory namespaces. They do not:
- Spawn Claude Code instances with working tool access
- Distribute tasks to running agents
- Collect or aggregate results
- Coordinate actual parallel execution

The `hive-mind spawn --claude` command is the closest to actual execution, but it generates a prompt that references MCP tools (`mcp__ruflo__hive-mind_consensus`, `mcp__ruflo__task_create`, etc.) that are not registered in the spawned environment. This is the same failure mode as V3 (slice 285): the tools exist in Ruflo's documentation but not in the Claude Code session.

---

## 5. Coordination Overhead Analysis

| Category | Tokens/Time |
|---|---|
| Swarm init ceremony | ~5s, CLI output only |
| Swarm start ceremony | ~10s, CLI output only |
| Swarm coordinate ceremony | ~5s, CLI output only |
| Hive-mind init + spawn | ~15s, generated unreachable prompt |
| Hive-mind prompt size | ~2000 tokens (referencing non-existent tools) |
| **Useful work produced** | **0 tokens, 0 output** |
| **Coordination overhead** | **100%** — all cost was overhead |

---

## 6. Verdict

**Drop swarm.** Do not re-test with a different shape.

### Rationale

1. **Swarm cannot execute.** Across 5 CLI commands (init, start, coordinate, status, hive-mind spawn), zero tasks were created and zero output was produced. The swarm is a state machine with no executor.

2. **MCP tool gap is fundamental.** The hive-mind prompt references 20+ `mcp__ruflo__*` tools that don't exist in spawned Claude sessions. This is the same gap identified in V3 (slice 285) and Fix-2 (slice 288) — upstream packaging bug, not a configuration issue.

3. **No complexity threshold exists.** The brief asked for a threshold above which swarm becomes viable. Since the swarm produces zero output regardless of task complexity, no such threshold exists. The limiting factor isn't task complexity — it's that the execution layer doesn't work.

4. **Rom-alone is complete and fast.** A single agent completed the same 3-phase task in ~45 seconds with perfect accuracy. Parallelism via Claude Code's native Agent tool (Explore subagents) is sufficient for decomposable tasks.

### What could change this verdict

Only if Ruflo fixed the MCP tool registration gap so that spawned agents actually have access to the tools referenced in the coordination prompt. This requires:
- Ruflo hooks loading correctly per-plugin (Fix-2's packaging bug)
- MCP server connecting within Claude Code's timeout (Fix-1's cold-cache issue)
- Spawned `claude -p` sessions having tool definitions injected, not just referenced in a prompt

None of these are on our roadmap to fix. They are upstream Ruflo issues.

---

## 7. Series Summary (G1-G5)

| Gen | Slice(s) | Question | Answer |
|---|---|---|---|
| G1 (Probe) | 277 | Can Ruflo replace `claude -p`? | No — orchestration layer, not CLI replacement |
| G2 (RAG A/B) | 282,284,285 | Do MCP tools improve individual agent quality? | No — 0 tool calls, cost increases, same or worse quality |
| G3 (Fixes) | 287,288 | Can we fix the connection/hook issues? | Workarounds exist but don't address usefulness gap |
| G3b (V4) | 289 | Does real refactor task change the picture? | No — byte-identical output, +163% cost |
| G4 (Nog) | 290 | Can RAG improve Nog verdict consistency? | BLOCKED — no verdict data, tools non-functional |
| **G5 (Swarm)** | **291** | **Does swarm coordination beat Rom-alone?** | **No — swarm produces zero output, Rom-alone completes in 45s** |

**Recommendation:** Close the Ruflo investigation. Six generations of experiments converge on the same conclusion: Ruflo adds cost and complexity with zero measurable benefit. The original cost-routing goal (Bet-2) should be pursued via `ANTHROPIC_BASE_URL` proxy (LiteLLM/OpenRouter), which is independent of Ruflo.
