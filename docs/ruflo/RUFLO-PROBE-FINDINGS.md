# Ruflo / agentic-flow Probe Findings

**Slice:** W-Ruflo-1 (brief 277)
**Probed:** 2026-05-01
**Probe directory:** `experiments/ruflo-probe/`

---

## 1. TL;DR

**Neither `claude-flow` nor `agentic-flow` is a drop-in replacement for `claude -p`.** Both are orchestration layers that sit *on top of* Claude (or other LLMs), not replacements for the Claude CLI itself.

- **`claude-flow`** (Ruflo v3) is a full agent-orchestration platform with 237 MCP tools, swarm coordination, memory, and task management. It does **not** expose a headless single-shot `prompt → response` CLI invocation. Its agent spawn is a registration action, not a prompt-execution action. It assumes an MCP server is running and agents are managed through that surface.

- **`agentic-flow`** v2 exposes a headless single-shot invocation (`--agent <type> --task "<prompt>"`) that calls the Anthropic API directly and returns text output. It also provides a proxy server that redirects `claude` CLI traffic through OpenRouter/Gemini, enabling multi-provider routing for Claude Code. This is the closer match to our use case, but it wraps the Anthropic *API*, not `claude -p` (Claude Code CLI). It does not inherit Claude Code's tool use, file access, or permission model.

**Recommendation: Path 4** — neither tool fits the `claude -p` invocation swap goal as originally conceived. See Section 6.

---

## 2. Versions Probed

| Package | npm version | CLI banner |
|---|---|---|
| `claude-flow` | `3.6.12` | `ruflo v3.6.12` |
| `agentic-flow` | `2.0.7` | `Agentic Flow v2.0.7` |

Installed via `npm install --save-exact` in sandboxed `experiments/ruflo-probe/`.

---

## 3. claude-flow Surface

### 3.1 CLI Help (probe step 1)

Full help captured in `probe-claude-flow-1-help.txt`. Major command groups:

- **Primary:** `init`, `start`, `status`, `agent`, `swarm`, `memory`, `task`, `session`, `mcp`, `hooks`
- **Advanced:** `neural`, `security`, `performance`, `embeddings`, `hive-mind`, `ruvector`, `guidance`, `autopilot`
- **Utility:** `config`, `doctor`, `daemon`, `completions`, `migrate`, `workflow`
- **Analysis:** `analyze`, `route`, `progress`
- **Management:** `providers`, `plugins`, `deployment`, `claims`, `issues`, `update`, `process`, `appliance`, `cleanup`

No `run`, `prompt`, `exec`, or `ask` command exists. There is no single-shot prompt execution surface.

### 3.2 Subcommand Help (probe step 2)

Key subcommands probed: `agent`, `task`, `mcp`, `start`, `session`. See `probe-claude-flow-2-subcmds.txt`.

- `agent spawn -t coder` — registers an agent in the system (returns ID, type, status "registered"). Does NOT execute a prompt. The agent is a registration record, not a running process.
- `task create` — creates a task record to be assigned to an agent. Task lifecycle is: create → assign → (agent picks up via orchestrator).
- `mcp start` — starts an MCP server (stdio or HTTP). This is the primary integration surface.
- `start` — starts the full orchestration system (MCP server + swarm topology).

### 3.3 Version (probe step 3)

`npx claude-flow --version` → `ruflo v3.6.12`. Matches pinned version.

### 3.4 Headless Single-Shot (probe step 4)

**No equivalent exists.** There is no command that takes a prompt string and returns a completion. `agent spawn` registers an agent but does not execute anything. `task create` creates a task record. Neither produces LLM output on stdout.

The closest path would be: start MCP server → use MCP tool `agent_spawn` + `task_create` + `task_assign` → poll for result. This is a multi-step orchestration flow, not a single-shot invocation.

### 3.5 Env Var Contract (probe step 5)

The help text does not list environment variables directly. The `providers` subcommand shows supported providers:

| Provider | Type | Status |
|---|---|---|
| Anthropic | LLM | Not configured |
| OpenAI | LLM | Not configured |
| Google | LLM | Not configured |
| Transformers.js | Embedding | Available (local) |
| Agentic Flow | Embedding | Available (local) |
| Mock | All | Dev only |

Configuration is managed via `providers configure -p <name> -k <key>`. Env var names are not surfaced in help text; configuration appears to be stored internally.

### 3.6 MCP Mode (probe step 6)

MCP server starts successfully on stdio. Responds to JSON-RPC `initialize`:

```json
{
  "protocolVersion": "2024-11-05",
  "serverInfo": {"name": "claude-flow", "version": "3.0.0"},
  "capabilities": {"tools": {"listChanged": true}, "resources": {"subscribe": true, "listChanged": true}}
}
```

**237 MCP tools** registered across categories:

| Category | Tool count | Examples |
|---|---|---|
| Agent | 7 | `agent_spawn`, `agent_terminate`, `agent_list` |
| Swarm | 4 | `swarm_init`, `swarm_status`, `swarm_shutdown` |
| Memory | 10 | `memory_store`, `memory_search`, `memory_import_claude` |
| Config | 6 | `config_get`, `config_set`, `config_export` |
| Hooks | 14 | `hooks_pre-edit`, `hooks_route`, `hooks_build-agents` |
| Task | ~6 | `task_create`, `task_list`, `task_status` |
| + many more | ~190 | neural, security, workflow, GitHub, etc. |

### 3.7 Multi-Provider Routing (probe step 7)

`providers list` shows Anthropic, OpenAI, and Google as configurable LLM providers. Configuration is done via `providers configure -p <name>`. The MCP `agent_spawn` tool accepts a `model` parameter with enum `["haiku", "sonnet", "opus", "inherit"]` — Claude-only model selection.

Multi-provider routing exists conceptually but is managed through the orchestration layer, not a CLI flag on a single-shot command.

### 3.8 Permission / Write-Protection (probe step 8)

`agent spawn` did NOT create any files under `.claude/`. The probe directory's `.claude/` did not exist after spawning an agent. claude-flow does not appear to write to `.claude/` during basic operations. It stores state internally (likely in-memory or in its own data directory).

---

## 4. agentic-flow Surface

### 4.1 CLI Help (probe step 1)

Full help captured in `probe-agentic-flow-1-help.txt`. Major commands:

- **Core:** `config`, `mcp`, `agent`, `federation`, `proxy`, `claude-code`
- **Execution:** `--agent <name> --task "<prompt>"` (inline on root command)
- **Utility:** `--list`, `--optimize`

### 4.2 Subcommand Help (probe step 2)

Key subcommands probed: `agent`, `proxy`, `claude-code`, `federation`, `config`, `mcp`. See `probe-agentic-flow-2-subcmds.txt`.

- `proxy` — standalone Anthropic-compatible proxy server. Redirects requests to Gemini or OpenRouter.
- `claude-code` — spawns Claude Code CLI with auto-configured proxy for alternative providers. Uses Commander.js; well-structured help.
- `mcp start` — starts MCP server on stdio with 15 tools (7 agentic-flow + 3 agent-booster + 5 agentdb).

### 4.3 Version (probe step 3)

`npx agentic-flow --version` → `agentic-flow v2.0.7`. Matches pinned version.

### 4.4 Headless Single-Shot (probe step 4)

**Yes, it exists:** `npx agentic-flow --agent coder --task "say hello"`

- **Invocation:** `npx agentic-flow --agent <type> --task "<prompt>" [--provider <p>] [--output <fmt>]`
- **Stdout shape:** Text output (raw response). JSON and markdown formats available via `--output`.
- **Stderr:** Error messages (e.g., missing API key) go to stderr.
- **Exit code:** 0 on success (even when API key is missing — the error goes to stderr).
- **API key required:** `ANTHROPIC_API_KEY` by default. Alternatives: `--provider openrouter` (needs `OPENROUTER_API_KEY`), `--provider gemini` (needs `GOOGLE_GEMINI_API_KEY`), `--provider onnx` (no key, local inference).
- **Token usage:** Not observed in stdout during key-missing probe. Unknown if reported on successful invocation.
- **Cost reporting:** Not observed. Unknown if reported on successful invocation.

**Critical distinction:** This calls the Anthropic Messages API directly. It does NOT invoke `claude -p` (Claude Code CLI). The agent's "system prompt" comes from bundled agent definition files, not from Claude Code's tool-use framework. The response is a raw LLM completion without Claude Code's file access, tool use, or permission model.

### 4.5 Env Var Contract (probe step 5)

Clearly documented in help text:

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API key (for Claude models) |
| `OPENROUTER_API_KEY` | OpenRouter API key (for alternative models) |
| `GOOGLE_GEMINI_API_KEY` | Google Gemini API key |
| `USE_OPENROUTER` | Force OpenRouter usage (`true`/`false`) |
| `USE_GEMINI` | Force Gemini usage (`true`/`false`) |
| `COMPLETION_MODEL` | Default model for OpenRouter |
| `AGENTS_DIR` | Path to agents directory |
| `PROXY_PORT` | Proxy server port (default: 3000) |
| `QUIC_PORT` | QUIC transport port (default: 4433) |
| `QUIC_CERT_PATH` | TLS certificate for QUIC |
| `QUIC_KEY_PATH` | TLS private key for QUIC |
| `ONNX_MODEL_PATH` | Local ONNX model path |

### 4.6 MCP Mode (probe step 6)

MCP server starts on stdio. Responds to `initialize`:

```json
{
  "protocolVersion": "2024-11-05",
  "serverInfo": {"name": "agentic-flow", "version": "1.0.8"},
  "capabilities": {"tools": {}, "logging": {}, "completions": {}}
}
```

**15 MCP tools** registered:

| Tool | Description |
|---|---|
| `agentic_flow_agent` | Execute agent with task (13 params) |
| `agentic_flow_list_agents` | List 66+ agents |
| `agentic_flow_create_agent` | Create custom agent |
| `agentic_flow_list_all_agents` | List with sources |
| `agentic_flow_agent_info` | Agent details |
| `agentic_flow_check_conflicts` | Conflict detection |
| `agentic_flow_optimize_model` | Auto-select best model |
| `agent_booster_edit_file` | Fast code editing (WASM) |
| `agent_booster_batch_edit` | Multi-file refactoring |
| `agent_booster_parse_markdown` | LLM output parsing |
| `agentdb_stats` | Database statistics |
| `agentdb_pattern_store` | Store reasoning patterns |
| `agentdb_pattern_search` | Search similar patterns |
| `agentdb_pattern_stats` | Pattern analytics |
| `agentdb_clear_cache` | Clear query cache |

### 4.7 Multi-Provider Routing (probe step 7)

**First-class support.** CLI flags:

- `--provider anthropic` (default)
- `--provider openrouter` + `OPENROUTER_API_KEY`
- `--provider gemini` + `GOOGLE_GEMINI_API_KEY`
- `--provider onnx` (local, no key)
- `--model "org/model"` for specific model selection

**Proxy mode** for Claude Code integration:
```bash
npx agentic-flow proxy --provider openrouter --port 3000
# Then configure Claude Code:
export ANTHROPIC_BASE_URL=http://localhost:3000
export ANTHROPIC_API_KEY=sk-ant-proxy-dummy-key
claude  # Now uses OpenRouter via proxy
```

Also: `npx agentic-flow claude-code --provider openrouter "task"` — auto-starts proxy and spawns `claude` CLI.

### 4.8 Permission / Write-Protection (probe step 8)

agentic-flow's `agent create` writes custom agents to `.claude/agents/` by default (`--agents-dir` overrides). No evidence of write-protection for `.claude/` — it actively writes there. However, the `--agent --task` execution mode (headless) does not appear to create files; it's a stateless API call.

---

## 5. Comparison Table

| Feature | `claude-flow` v3.6.12 | `agentic-flow` v2.0.7 | `claude -p` (current) |
|---|---|---|---|
| Headless single-shot CLI | **No** | **Yes** (`--agent --task`) | **Yes** (`-p "prompt"`) |
| Token usage in stdout | N/A | Unknown (needs live test) | Yes (`--output-format json`) |
| Cost in stdout | N/A | Unknown | No (but tokens reported) |
| Multi-provider routing | Config-based (orchestrator) | **Yes** (CLI flag + proxy) | No (Anthropic only) |
| Claude as provider | Yes (via config) | Yes (default) | N/A (IS Claude) |
| MCP server | **Yes** (237 tools) | **Yes** (15 tools) | No (is an MCP client) |
| Claude Code tool use | No | No (raw API only) | **Yes** (Read, Edit, Bash, etc.) |
| File system access | No | No | **Yes** |
| Permission model | No | No | **Yes** (allowlists) |
| Heartbeat equivalent | System status command | No | No (custom in watcher) |
| Output format control | `--format json/text/table` | `--output text/json/md` | `--output-format json/text/stream-json` |
| Invocation model | Orchestration platform | API wrapper + proxy | CLI tool with agent loop |

---

## 6. Recommendation

### **Path 4: Neither tool fits the `claude -p` invocation swap goal.**

**Rationale:**

The original swap plan assumed Ruflo (`claude-flow`) could replace `claude -p` as the headless invocation command in the watcher's spawn path. This probe reveals that assumption was wrong on two axes:

1. **`claude-flow` is not a CLI tool for running prompts.** It is an orchestration platform (MCP server, swarm coordination, agent lifecycle management). It has no single-shot prompt → response command. Its value proposition is coordinating multiple agents, not being one.

2. **`agentic-flow` has a headless CLI** (`--agent --task`), but it calls the Anthropic Messages API directly — it does NOT invoke `claude -p` or Claude Code. This means:
   - No tool use (Read, Edit, Bash, Write, Grep, Glob)
   - No file system access
   - No `.claude/CLAUDE.md` loading
   - No permission model
   - No conversation persistence
   - The response is a raw LLM completion, not an agent action

   The watcher's spawn path needs Claude Code's full agent loop (tools, file access, report writing), not a raw API call.

3. **agentic-flow's proxy mode** is interesting for cost optimization (routing Claude Code traffic through cheaper providers), but it's orthogonal to the invocation swap — it still requires `claude` CLI underneath.

**What would actually work for multi-provider routing:**
- agentic-flow's proxy mode (`npx agentic-flow proxy --provider openrouter`) could sit in front of `claude -p` for cost savings, but the invocation command remains `claude -p`.
- LiteLLM or OpenRouter as a proxy would achieve the same thing with less tooling overhead.
- The invocation layer doesn't need swapping — the *provider routing layer* does, and that's a `ANTHROPIC_BASE_URL` environment variable change, not a CLI tool swap.

**Proposed alternative (for follow-up slice if desired):**
Instead of swapping `claude -p`, add a proxy layer in front of it. The watcher would set `ANTHROPIC_BASE_URL` to point at a local proxy (agentic-flow proxy, LiteLLM, or OpenRouter direct) before spawning `claude -p`. This preserves the full Claude Code agent loop while enabling multi-provider routing.

---

## 7. What This Slice Did NOT Determine

1. **agentic-flow headless output shape on successful invocation** — Could not test with a live API key in the probe. Token/cost reporting in stdout is unknown.
2. **claude-flow's actual agent execution model** — How does a spawned agent actually run tasks? Does it invoke `claude -p` internally? The orchestration flow was not traced beyond the registration step.
3. **agentic-flow proxy latency and reliability** — The proxy was not started or tested. Actual overhead of routing through the proxy is unknown.
4. **agentic-flow proxy compatibility with Claude Code's streaming** — Claude Code uses streaming JSON; whether the proxy preserves this faithfully is untested.
5. **ONNX local inference quality** — agentic-flow supports `--provider onnx` for free local inference. Quality/capability for code tasks is unknown.
6. **claude-flow's 237 MCP tools actual functionality** — Tool registration was verified; actual execution was not tested beyond agent spawn.
7. **Federation/swarm capabilities** — Both tools have multi-agent coordination features that were explicitly out of scope.
8. **Whether agentic-flow's `claude-code` subcommand** faithfully passes through all Claude Code flags (e.g., `--output-format`, `--allowedTools`, custom system prompts).
9. **Cost comparison** — Actual per-invocation cost savings from OpenRouter/Gemini routing vs direct Anthropic API were not measured.
10. **Security posture** — Neither tool was audited for credential handling, sandboxing, or supply-chain risk (both have significant dependency trees: 656 packages total).
