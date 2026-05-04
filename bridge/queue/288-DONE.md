---
id: "288"
title: "W-Ruflo-Fix-2 — Find non-interactive plugin install path for headless claude -p"
from: rom
to: nog
status: DONE
slice_id: "288"
branch: "slice/288"
completed: "2026-05-04T19:58:00.000Z"
tokens_in: 85000
tokens_out: 12000
elapsed_ms: 1800000
estimated_human_hours: 3.0
compaction_occurred: false
---

# W-Ruflo-Fix-2 — Headless Plugin Install Investigation

## Result: Path exists, hooks blocked by ruflo packaging bug

### What was found

1. **`claude plugin install` is a non-interactive CLI command.** It works headlessly without user prompts. Install at user or project scope; `claude -p` picks up pre-installed plugins automatically.

2. **Plugin install = settings.json entry.** The command adds `"enabledPlugins": { "ruflo-core@ruflo": true }` to settings and caches the plugin directory. No interactive flow required.

3. **Skills, commands, and agents load correctly in `claude -p`.** Verified with debug logs: ruflo-core's 3 skills, 1 command, and 3 agents all appeared in a headless session.

4. **Hooks DO NOT load — ruflo packaging bug.** Ruflo's hooks (`PreToolUse`, `PostToolUse`, `PreCompact`, `Stop`) are defined at the marketplace root (`ruflo/.claude-plugin/hooks/hooks.json`), not inside individual plugin directories. Claude Code's loader expects hooks at `<plugin>/hooks/hooks.json`. Comparison with the official `hookify` plugin confirmed: hookify places hooks inside its own directory and they load correctly (4 hooks registered).

5. **Marketplace add requires extended timeout.** The `ruvnet/ruflo` repo is ~300MB; default 120s clone timeout is insufficient. Set `CLAUDE_CODE_PLUGIN_GIT_TIMEOUT_MS=300000`.

### Acceptance criteria

| Criterion | Status |
|-----------|--------|
| `experiments/ruflo-fix-2/` exists with investigation artifacts | DONE |
| `docs/ruflo/PLUGIN-INSTALL-HEADLESS.md` exists with recipe + caveats | DONE |
| Doc names concrete next step | DONE |
| No production code changed | DONE |

### Artifacts created

- `experiments/ruflo-fix-2/findings.md` — Full investigation with architecture details
- `experiments/ruflo-fix-2/debug-log-ruflo-core.txt` — Debug log excerpts proving 0 hooks loaded
- `experiments/ruflo-fix-2/headless-output.txt` — Actual output from headless `claude -p` with ruflo-core
- `docs/ruflo/PLUGIN-INSTALL-HEADLESS.md` — Setup recipe, verification steps, blocker documentation

### Verdict for the portfolio

The headless plugin install path works for skills/commands/agents but not for hooks. Since hooks are Ruflo's only differentiated value claim (per Dax's post-mortem), and the hook loading is broken due to a ruflo packaging issue:

- **The drop verdict from the original investigation (slice 286) is reinforced.** Even with the correct install path, Ruflo's hooks don't load due to their own packaging bug.
- **Upstream issue recommended** on `ruvnet/ruflo` for hook relocation into plugin directories.
- **No blocker on our side.** Claude Code's plugin system works correctly. The gap is in ruflo's packaging.

### Setup environment

- Claude Code: current version
- macOS Darwin 25.4.0
- ruflo marketplace: `ruvnet/ruflo` (git commit f8ce233)
- ruflo-core plugin: v0.1.0
- All test plugins uninstalled and marketplace removed after investigation (clean state)
