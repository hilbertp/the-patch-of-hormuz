# Ruflo Plugin Install — Headless Investigation Findings

**Slice:** 288 (W-Ruflo-Fix-2)
**Date:** 2026-05-04
**Goal:** Determine if `/plugin install ruflo-core@ruflo` can be invoked headlessly for `claude -p`

---

## 1. Key Findings

### Finding 1: `claude plugin install` IS a headless CLI command

The `/plugin install` slash command is NOT the only path. Claude Code exposes a full CLI:

```
claude plugin install <plugin>[@<marketplace>] --scope user|project|local
claude plugin uninstall <plugin> --scope <scope>
claude plugin list
claude plugin marketplace add <source>
claude plugin marketplace remove <name>
```

These commands run non-interactively and require no user prompts. They are fully suitable for scripted/headless setup.

### Finding 2: Plugin install = settings.json entry + cached files

Installing a plugin does two things:
1. Adds `"enabledPlugins": { "ruflo-core@ruflo": true }` to settings.json (user or project scope)
2. Copies the plugin directory to `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`
3. Registers in `~/.claude/plugins/installed_plugins.json`

### Finding 3: Pre-installed plugins DO load in `claude -p` headless mode

Verified: a plugin installed at user scope (`--scope user`) is automatically picked up by subsequent `claude -p` invocations. Debug log confirms:

```
Loaded 1 installed plugins from installed_plugins.json
Found 1 plugins (1 enabled, 0 disabled)
Loaded 1 commands from plugin ruflo-core
Loaded 3 agents from plugin ruflo-core
Loaded 3 skills from plugin ruflo-core
```

The ruflo-core plugin's skills (`init-project`, `ruflo-doctor`, `discover-plugins`), commands (`ruflo-status`), and agents (`coder`, `reviewer`, `researcher`) all loaded successfully.

### Finding 4: ruflo-core hooks DO NOT load — packaging bug

**This is the critical blocker.** Debug log shows:

```
Registered 0 hooks from 1 plugins
```

The hooks defined in `ruflo/.claude-plugin/hooks/hooks.json` (PreToolUse, PostToolUse, PreCompact, Stop) are at the **marketplace root level**, not inside the `plugins/ruflo-core/` directory. Claude Code's plugin loader only reads hooks from `<plugin>/hooks/hooks.json`, not from the marketplace root.

**Proof by comparison:** The official `hookify` plugin places its `hooks/hooks.json` inside the plugin directory itself. When installed, Claude Code finds and registers 4 hooks:

```
Loaded hooks from standard location for plugin hookify: .../hookify/unknown/hooks/hooks.json
Loading hooks from plugin: hookify
Registered 4 hooks from 2 plugins
```

Ruflo's hooks are misplaced — they're at `ruflo/.claude-plugin/hooks/hooks.json` instead of `ruflo/plugins/ruflo-core/hooks/hooks.json`.

### Finding 5: Marketplace add is slow due to repo size

The `ruvnet/ruflo` repo is large enough that `claude plugin marketplace add` times out at the default 120-second clone timeout. Required workaround:

```bash
CLAUDE_CODE_PLUGIN_GIT_TIMEOUT_MS=300000 claude plugin marketplace add https://github.com/ruvnet/ruflo.git
```

---

## 2. Plugin System Architecture

### Storage locations

| Item | Path |
|---|---|
| Marketplace repos | `~/.claude/plugins/marketplaces/<name>/` |
| Plugin cache | `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/` |
| Install registry | `~/.claude/plugins/installed_plugins.json` |
| Known marketplaces | `~/.claude/plugins/known_marketplaces.json` |
| User settings | `~/.claude/settings.json` (enabledPlugins) |
| Project settings | `.claude/settings.json` (enabledPlugins) |

### Plugin directory structure (what Claude Code loads)

```
<plugin>/
  .claude-plugin/
    plugin.json       # name, description, version, author
  commands/           # slash commands (markdown files)
  skills/             # skills (directories with SKILL.md)
  agents/             # agent definitions (markdown files)
  hooks/
    hooks.json        # hook definitions (PreToolUse, PostToolUse, etc.)
```

### What loads in `claude -p` headless mode

| Component | Loads? | Mechanism |
|-----------|--------|-----------|
| Commands | YES | From `<plugin>/commands/` |
| Skills | YES | From `<plugin>/skills/` |
| Agents | YES | From `<plugin>/agents/` |
| Hooks | YES* | From `<plugin>/hooks/hooks.json` — *only if present in the plugin directory* |
| MCP servers | NO | Separate `--mcp-config` path |

---

## 3. The Headless Setup Recipe (would work IF hooks were correctly packaged)

### Step 1: Add the ruflo marketplace (one-time)

```bash
CLAUDE_CODE_PLUGIN_GIT_TIMEOUT_MS=300000 \
  claude plugin marketplace add https://github.com/ruvnet/ruflo.git
```

### Step 2: Install plugins

```bash
claude plugin install ruflo-core@ruflo --scope user
# Or for project-level:
claude plugin install ruflo-core@ruflo --scope project
```

### Step 3: Verify

```bash
claude plugin list
# Should show: ruflo-core@ruflo (enabled)
```

### Step 4: Use with claude -p

```bash
echo "Your prompt" | claude -p
# Plugin skills, commands, and agents are automatically available
```

### Alternative: --plugin-dir for session-only loading

```bash
echo "Your prompt" | claude -p --plugin-dir /path/to/ruflo-core
```

This loads the plugin for a single session without installing it.

---

## 4. Verdict

**A headless plugin install path EXISTS and WORKS for skills, commands, and agents.** The `claude plugin install` CLI command is non-interactive and suitable for scripted setup.

**However, Ruflo's hooks do not load** because they are packaged at the marketplace root level instead of inside each plugin's directory. This is a ruflo packaging bug, not a Claude Code limitation. The official `hookify` plugin demonstrates the correct pattern.

### What's needed to unblock hooks:

**Upstream fix (ruflo repo):** Move hooks from `ruflo/.claude-plugin/hooks/hooks.json` into `ruflo/plugins/ruflo-core/hooks/hooks.json` (or create a dedicated `ruflo-hooks` plugin). This is a file reorganization, not a code change.

**Workaround until upstream fix:** Manually copy the hooks.json from the marketplace root into the plugin's cache directory:

```bash
cp ~/.claude/plugins/marketplaces/ruflo/.claude-plugin/hooks/hooks.json \
   ~/.claude/plugins/cache/ruflo/ruflo-core/0.1.0/hooks/hooks.json
```

(Untested — may need the hooks/ directory created first, and may be overwritten on plugin update.)

---

## 5. Ruflo Plugin Inventory

The ruflo marketplace offers 32 plugins. Key ones relevant to our investigation:

| Plugin | What it provides |
|--------|-----------------|
| `ruflo-core` | Core commands, skills (init, doctor, discover), agents (coder, reviewer, researcher) |
| `ruflo-swarm` | Agent teams, swarm coordination, worktree isolation |
| `ruflo-rag-memory` | RuVector memory, HNSW search, semantic retrieval |
| `ruflo-intelligence` | SONA patterns, trajectory learning, model routing |
| `ruflo-loop-workers` | Cache-aware /loop workers, CronCreate automation |

None of these plugins include hooks in their own directories. All hooks are at the marketplace root.
