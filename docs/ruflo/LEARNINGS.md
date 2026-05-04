# Ruflo Investigation — Consolidated Learnings

**Owner:** Worf
**Status:** Investigation complete. Verdict: drop Ruflo.
**Slices:** 277 (probe), 282 (V1 A/B), 284 (V2 A/B), 285 (V3 forced invocation)
**Date range:** 2026-05-01 → 2026-05-04

---

## 1. TL;DR

The Ruflo investigation ran four slices over four days, testing whether `claude-flow` (Ruflo v3) could serve as an invocation-layer replacement or RAG-augmentation tool for our `claude -p` orchestrator. It cannot. The probe (slice 277) established that claude-flow is an orchestration platform that sits on top of Claude, not a CLI replacement. Three subsequent A/B experiments (slices 282, 284, 285) attached claude-flow's MCP server to Rom runs — across code-generation, cross-file retrieval, and forced-invocation tasks, the model either ignored Ruflo's 237 tools in favor of native Read/Grep/Glob (V1, V2) or the MCP server failed to connect entirely (V3). Zero Ruflo tool calls across all experiments. Drop Ruflo-RAG. The original cost-routing goal survives independently via an `ANTHROPIC_BASE_URL` proxy approach (LiteLLM/OpenRouter/agentic-flow proxy), which is in front of Sisko for scoping.

---

## 2. What Ruflo actually is

Ruflo (`claude-flow` v3.6.12) is a full agent-orchestration platform — MCP server, swarm coordination, memory, task management — that sits *on top of* Claude Code, not a replacement for `claude -p`. Its architecture is `User → Claude Code → Ruflo → Swarm → Agents → LLM Providers`. It has no single-shot prompt → response command; the closest invocation path requires starting an MCP server, spawning an agent, creating a task, assigning it, and polling for results. See [RUFLO-PROBE-FINDINGS.md](RUFLO-PROBE-FINDINGS.md) §3 for the full surface audit.

---

## 3. What we tested

Three A/B experiments after the initial probe, each attaching claude-flow's MCP server (237 tools) to a Rom `claude -p` run:

| Slice | Experiment | Hypothesis | Setup | Result |
|---|---|---|---|---|
| 282 (V1) | [RAG-AB-FINDINGS.md](RAG-AB-FINDINGS.md) | Ruflo MCP attached to `claude -p` improves single-task code generation | Single-shot module write (`gate-history.js` + test), claude-flow MCP attached | 0 tool calls. Equivalent output. 23% cheaper (prompt cache variance from sequential runs, not Ruflo). |
| 284 (V2) | [RAG-AB-FINDINGS-V2.md](RAG-AB-FINDINGS-V2.md) | Retrieval-heavy task forces RAG tool usage | Cross-file event catalog audit (scan 13 files for all `registerEvent` sites) | 0 tool calls. Missed 6 events vs base. 29% cheaper (fewer turns = less thorough scanning). |
| 285 (V3) | [RAG-AB-FINDINGS-V3.md](RAG-AB-FINDINGS-V3.md) | Explicit prompt instruction forces Ruflo tool calls | Prompt explicitly named claude-flow tools to call; required documenting tool usage | MCP server never connected. 0 tools registered. 3 ToolSearch queries returned 0 matches. 91% more expensive (wasted turns searching for non-existent tools). |

---

## 4. Why we conclude drop Ruflo

Four independent findings converge on the same verdict:

1. **Tools ignored when present (V1, V2).** Across two experiments with different task shapes (code-gen and retrieval), Claude's native Read/Grep/Glob tools were strictly preferred. The 237 claude-flow tool definitions added ~26K tokens of context overhead with zero invocations. The model rationally avoids them because native tools are sufficient for this codebase size.

2. **MCP server unreliable (V3).** When we explicitly required Ruflo tool invocation, `npx -y claude-flow@latest mcp start` either timed out or failed silently in headless `claude -p` mode. The server was listed as "still connecting" for the entire session. This reveals a reliability problem on top of the usefulness problem.

3. **No quality improvement.** In V1 both runs produced functionally identical output. In V2 the Ruflo-augmented run was *less* complete (55 events vs 61), missing events that the base run caught. In V3 the output was produced entirely by native tools after Ruflo failed.

4. **Cost savings were artifacts, not benefits.** V1's 23% cost reduction was prompt cache warming from sequential execution. V2's 29% reduction came from fewer turns (less thorough scanning). V3 was 91% *more* expensive due to wasted tool-search turns. No experiment showed cost savings attributable to Ruflo.

---

## 5. What's still alive

The original Bet-2 goal — cost reduction via multi-provider routing — is achievable independently of Ruflo:

- **Mechanism:** Set `ANTHROPIC_BASE_URL` to a proxy (LiteLLM, OpenRouter direct, or agentic-flow's proxy mode).
- **Transparency:** The orchestrator's existing `claude -p` calls flow through the proxy transparently. The agent loop, tool use, file access, and `CLAUDE.md` loading are all preserved.
- **Scope:** This is an env-var change, not a CLI swap. No changes to the watcher, queue, or brief/report contracts.
- **Owner:** Sisko has the scoping question. The proxy approach was surfaced in the slice 277 probe findings and handed off for prioritization.

---

## 6. Process learnings (meta)

Two things this investigation reinforced for future cross-tool evaluations:

- **Probe before swap.** O'Brien's original handoff framed Ruflo as a `claude -p` drop-in replacement. The probe (slice 277) killed that framing on day one by revealing Ruflo is an orchestration layer, not a CLI tool. The probe-first slice should be the default for any "swap X for Y" plan. It cost one slice but saved us from building integration work against a wrong assumption.

- **MCP server availability ≠ tool usability.** Attaching an MCP server to a `claude -p` session does not compel the model to use its tools. Two conditions must both hold for an MCP-based evaluation to be valid: (1) the MCP server must actually connect and register tools in time for the session, and (2) the prompt must create a task where the MCP tools offer a clear advantage over native tools. In our case, condition 1 failed in V3, and condition 2 was never met in V1/V2 because native tools were sufficient.

---

## 7. What this doc does NOT cover

- **Other Ruflo plugins beyond claude-flow's MCP** (vector memory, federation, swarm coordination). Out of scope; we only tested the MCP server because that's the only seam that fit our `claude -p` spawn shape.
- **Whether Ruflo would be useful in interactive Claude Code use** (not headless `claude -p`). Possibly useful for multi-agent coordination in an interactive session. Different question from ours.
- **Long-term cost numbers for the proxy approach.** Depends on Sisko's scoping decision and actual provider pricing at time of implementation.
- **Modifying or deleting the four prior findings docs.** They remain as raw evidence alongside this summary.
