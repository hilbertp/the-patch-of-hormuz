# Ruflo Plugin Install — Headless Path for `claude -p`

**Slice:** 288 (W-Ruflo-Fix-2)
**Date:** 2026-05-04
**Status:** Path exists with caveats. Hooks are blocked by a ruflo packaging bug.

---

## Summary

Claude Code's `claude plugin` CLI provides a fully non-interactive path to install, manage, and load plugins — including in headless `claude -p` mode. The ruflo marketplace's plugins (skills, commands, agents) load correctly. However, **Ruflo's hooks do not load** because they are packaged at the marketplace root instead of inside each plugin directory. This is a ruflo packaging issue, not a Claude Code limitation.

---

## Working Recipe: Install Ruflo Plugins for Headless Use

### Prerequisites

- Claude Code CLI installed
- Network access to GitHub (for initial marketplace clone)

### Step 1: Add the ruflo marketplace (one-time, ~3-5 minutes)

```bash
CLAUDE_CODE_PLUGIN_GIT_TIMEOUT_MS=300000 \
  claude plugin marketplace add https://github.com/ruvnet/ruflo.git
```

The ruflo repo is large (~300MB clone). The extended timeout is required.

### Step 2: Install desired plugins

```bash
# User-level (available to all projects):
claude plugin install ruflo-core@ruflo --scope user

# Project-level (only this project):
claude plugin install ruflo-core@ruflo --scope project

# Other available plugins:
claude plugin install ruflo-swarm@ruflo --scope user
claude plugin install ruflo-rag-memory@ruflo --scope user
```

### Step 3: Verify installation

```bash
claude plugin list
# Expected: ruflo-core@ruflo (enabled)
```

### Step 4: Use with headless `claude -p`

```bash
echo "Your prompt here" | claude -p
# Ruflo skills, commands, and agents are automatically available
```

### Alternative: Session-only loading (no install)

```bash
echo "Your prompt" | claude -p \
  --plugin-dir /path/to/ruflo/plugins/ruflo-core \
  --plugin-dir /path/to/ruflo/plugins/ruflo-swarm
```

---

## What Loads vs What Doesn't

| Component | Loads in `claude -p`? | Notes |
|-----------|----------------------|-------|
| Skills (init-project, ruflo-doctor, discover-plugins) | YES | Available as `/skill-name` |
| Commands (ruflo-status) | YES | Available as `/ruflo-status` |
| Agents (coder, reviewer, researcher) | YES | Available via Agent tool |
| Hooks (PreToolUse, PostToolUse, etc.) | NO | Packaging bug — see below |
| MCP tools (237 claude-flow tools) | Separate | Requires `--mcp-config`, not plugin install |

---

## Hook Loading Blocker

### The problem

Ruflo defines hooks at `ruflo/.claude-plugin/hooks/hooks.json` (marketplace root). Claude Code's plugin loader looks for hooks at `<plugin>/hooks/hooks.json` (inside the individual plugin directory). The ruflo plugins don't include a `hooks/` directory.

### Evidence

Debug log comparison:

```
# ruflo-core: no hooks directory in plugin
Registered 0 hooks from 1 plugins

# hookify (official plugin, correct packaging):
Loaded hooks from standard location for plugin hookify: .../hookify/unknown/hooks/hooks.json
Registered 4 hooks from 2 plugins
```

### What the hooks do

The ruflo hooks intercept:
- **PreToolUse (Bash):** Modifies bash commands via `npx claude-flow@alpha hooks modify-bash`
- **PreToolUse (Write/Edit):** Modifies file operations via `npx claude-flow@alpha hooks modify-file`
- **PostToolUse (Bash):** Tracks metrics, stores results
- **PostToolUse (Write/Edit):** Formats, updates memory, trains patterns
- **PreCompact:** Injects agent context guidance
- **Stop:** Generates session summary, persists state, exports metrics

These are the hooks Dax's post-mortem identified as Ruflo's claimed value ("auto-routes tasks, learns from successful patterns, coordinates agents").

### Fix required

**Upstream (ruflo repo):** Move or duplicate `ruflo/.claude-plugin/hooks/hooks.json` into each plugin that needs hooks, e.g., `ruflo/plugins/ruflo-core/hooks/hooks.json`. The `hookify` plugin from Anthropic's official marketplace demonstrates the correct pattern.

**Manual workaround (untested):**

```bash
# After installing ruflo-core, manually inject hooks into the cache:
mkdir -p ~/.claude/plugins/cache/ruflo/ruflo-core/0.1.0/hooks
cp ~/.claude/plugins/marketplaces/ruflo/.claude-plugin/hooks/hooks.json \
   ~/.claude/plugins/cache/ruflo/ruflo-core/0.1.0/hooks/hooks.json
```

Caveat: Plugin updates may overwrite the cache directory.

---

## How to Verify Hooks Are Active

```bash
echo "Test" | claude -p --debug-file /tmp/hook-test.log
grep "Registered.*hooks" /tmp/hook-test.log
# Should show: Registered N hooks from M plugins (where N > 0)
```

---

## Caveats

1. **Marketplace clone is slow.** The ruflo repo is ~300MB. First clone takes 3-5 minutes. Subsequent `marketplace update` calls re-pull.

2. **Plugin auto-update.** Claude Code checks for plugin updates on each session start. If ruflo pushes a new version, the cache is refreshed — which would overwrite manual hook injection.

3. **`--bare` flag skips plugins.** If `claude -p --bare` is used, plugin sync is skipped. Use `--plugin-dir` explicitly in bare mode.

4. **No first-run resolution.** Plugins are loaded from the local cache. If the cache is missing (fresh machine), the plugin won't load until `claude plugin install` runs.

---

## Concrete Next Step

The headless plugin install path works for skills/commands/agents. For hooks (the value Dax identified), either:

1. **File an upstream issue** on `ruvnet/ruflo` requesting hooks be moved into individual plugin directories (recommended — 15 minutes of work for the maintainer).
2. **Use the manual workaround** to test hooks immediately, accepting the fragility.
3. **Accept that hooks don't load** and evaluate ruflo plugins purely on their skills/agents/commands — which may or may not provide value beyond what we already have.

Given the prior investigation's conclusion (zero Ruflo tool calls across all experiments, model prefers native tools), option 3 + the upstream issue is the pragmatic path. The hooks are Ruflo's only differentiated value claim, and they're broken due to packaging. Filing the issue documents the gap while the drop verdict from the original investigation stands on independent grounds.
