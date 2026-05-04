# RAG A/B Findings V4 — Cross-File Refactor with Ruflo Plugin Install

**Slice:** 289 (W-Ruflo-Fix-3)
**Date:** 2026-05-04
**Base commit:** 1b02e72
**Prerequisites:** W-Ruflo-Fix-1 (slice 287, MCP timeout fix), W-Ruflo-Fix-2 (slice 288, plugin install path)

---

## 1. TL;DR

**Ruflo loses.** On a real retrieval-shaped task (cross-file rename across 51 files), Ruflo produced byte-identical output to stock Claude Code while costing 2.6x more ($0.50 vs $0.19) and taking 35% longer (100s vs 74s). Zero Ruflo tools were invoked. Zero hooks fired. The model ignored all 237 claude-flow MCP tools and used native Read/Grep/Edit exclusively.

---

## 2. Setup

### Prerequisites confirmed

- **Fix-1 (slice 287):** MCP timeout workaround applied — `npx -y claude-flow@latest --version` pre-warmed the npx cache. MCP server connected successfully (confirmed: `claude-flow mcp start` process visible during Run B).
- **Fix-2 (slice 288):** Headless plugin install used — `claude plugin install ruflo-core@ruflo --scope user` installed successfully. Plugin verified as enabled via `claude plugin list`. Hooks did NOT load (known packaging bug per Fix-2).

### Task

Cross-file refactor: rename `registerEvent` to `appendSliceEvent` everywhere (function definition, all call sites, test mocks, markdown docs). The identifier appears ~214 times across ~41 files. This task requires finding callers across many files, distinguishing partial matches (`registerEvents` plural), and updating code + docs consistently.

### Configuration

- **Run A (control):** `claude -p --permission-mode bypassPermissions --mcp-config mcp-base.json` (empty MCP config, no plugins installed)
- **Run B (treatment):** `claude -p --permission-mode bypassPermissions --mcp-config mcp-ruflo.json` (claude-flow MCP server with 237 tools, ruflo-core plugin installed at user scope)

Both runs against the same starting commit (1b02e72), same prompt, same working directory.

---

## 3. Run A — Stock Claude Code (Control)

| Metric | Value |
|--------|-------|
| Wall time | 74s |
| API time | 71.4s |
| Turns | 11 |
| Input tokens | 144,193 (8 fresh + 11,292 cache creation + 132,893 cache read) |
| Output tokens | 2,102 |
| Total cost | $0.19 |
| Files changed | 51 |
| Replacements | 230 (230 insertions, 230 deletions) |
| registerEvent remaining | 1 file (`test/queue-render.test.js` — contains `registerEvents` plural, correctly skipped) |
| Module loads? | Yes (`node -e "require('./bridge/orchestrator.js')"` passed) |

Self-report accuracy: correctly reported 51 files, 230 replacements.

---

## 4. Run B — Ruflo Plugin + MCP (Treatment)

| Metric | Value |
|--------|-------|
| Wall time | 100s |
| API time | 93.0s |
| Turns | 22 |
| Input tokens | 436,669 (17 fresh + 31,403 cache creation + 405,249 cache read) |
| Output tokens | 3,994 |
| Total cost | $0.50 |
| Files changed | 51 (identical diff to Run A) |
| Replacements | 230 (identical diff to Run A) |
| registerEvent remaining | 1 file (same as Run A) |
| Module loads? | Yes |
| **Ruflo MCP tool calls** | **0** |
| **Ruflo hook invocations** | **0** (empty stderr, hooks blocked by packaging bug per Fix-2) |
| **Ruflo plugin skills used** | **0** |

Self-report accuracy: reported 40 files / 212 replacements (actual: 51 files / 230 — undercounted due to higher turn count and context noise).

### MCP server status

The claude-flow MCP server started successfully (process confirmed running during the session). The 237 tools were injected into context. However, the model chose native tools (Grep, Read, Edit) for every operation.

### Hook status

No hooks fired. Ruflo's hooks are packaged at the marketplace root (`ruflo/.claude-plugin/hooks/hooks.json`) instead of inside the plugin directory where Claude Code expects them. This is the same packaging bug documented in Fix-2. The manual workaround (copying hooks into the plugin cache) was not applied — it is fragile and would be overwritten by plugin updates.

---

## 5. Comparison Table

| Metric | Run A (stock) | Run B (Ruflo) | Delta |
|--------|--------------|---------------|-------|
| Wall time | 74s | 100s | +35% |
| Cost | $0.19 | $0.50 | **+163%** |
| Turns | 11 | 22 | +100% |
| Input tokens | 144K | 437K | +203% |
| Output tokens | 2,102 | 3,994 | +90% |
| Files changed | 51 | 51 | 0 |
| Replacements | 230 | 230 | 0 |
| Remaining misses | 0 | 0 | 0 |
| Ruflo tool calls | N/A | 0 | — |
| Hook invocations | N/A | 0 | — |
| Output diff | — | **byte-identical** | — |
| Self-report accuracy | correct | undercounted | — |

---

## 6. Verdict

**Ruflo loses decisively.**

### Quality
Identical. Both runs produced the exact same 51-file, 230-line diff. `diff run-a.diff run-b.diff` returns 0. Neither missed any call sites. Both correctly skipped the partial match (`registerEvents` plural).

### Cost
Run B cost 2.6x more ($0.50 vs $0.19). The 237 MCP tool definitions injected ~293K extra tokens of context that the model had to process on every turn. This is pure overhead — the tools were never invoked.

### Speed
Run B took 35% longer (100s vs 74s). More turns (22 vs 11) and larger per-turn context explain the difference.

### Tool/hook utilization
Zero. Across all four V1-V4 A/B experiments and the V3 forced-invocation test, the model has never voluntarily invoked a Ruflo tool. The hooks (Ruflo's claimed differentiator — "auto-routes tasks, learns patterns, coordinates agents") remain broken due to the packaging bug identified in Fix-2.

### Why Ruflo doesn't help here
1. **Native tools are strictly better for this task.** Grep finds all call sites. Edit renames them. The model already knows how to do cross-file refactors with its built-in toolset.
2. **Ruflo's RAG layer adds nothing.** The 237 claude-flow tools are agent-orchestration primitives (spawn agents, manage workflows, coordinate swarms). They are irrelevant to a rename refactor.
3. **Hooks can't fire.** Even if they would help (e.g., by pre-indexing the codebase), they're blocked by the packaging bug.
4. **Context pollution hurts.** The extra 293K tokens of tool definitions degraded the model's self-reporting accuracy and doubled the turn count.

### Cumulative evidence (V1-V4)

| Version | Task type | Ruflo tool calls | Quality delta | Cost delta |
|---------|-----------|-----------------|---------------|------------|
| V1 (slice 282) | Single-file code gen | 0 | None | -22% (cache artifact) |
| V2 (slice 284) | Cross-file retrieval | 0 | Worse (-10% completeness) | -29% (cache artifact) |
| V3 (slice 285) | Forced invocation | MCP failed to connect | N/A | +91% (wasted turns) |
| V4 (slice 289) | Cross-file refactor | 0 | None (byte-identical) | **+163%** |

### Recommendation

**Drop Ruflo.** Four experiments across three task types confirm: the model prefers native Claude Code tools, Ruflo's MCP tools are ignored, hooks are broken, and the only measurable effect is increased cost. The original drop verdict from the consolidated learnings (slice 286) stands on even stronger evidence.
