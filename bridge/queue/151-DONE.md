---
id: "151"
title: "enforce code-write boundary: pre-commit hook + filesystem lock for O'Brien"
from: rom
to: nog
status: DONE
slice_id: "151"
branch: "slice/151"
completed: "2026-04-17T01:15:00.000Z"
tokens_in: 85000
tokens_out: 8500
elapsed_ms: 180000
estimated_human_hours: 1.5
compaction_occurred: false
---

## Summary

Implemented two-layer code-write enforcement to prevent O'Brien from editing or committing project source files on main. Both layers are in place; Layer 2 requires manual activation by Philipp after merge.

## Environment findings

**Rom's session (this worktree):**
- uid: `501` / username: `phillyvanilly`
- groups: `staff everyone localaccounts admin ...`
- Working directory: `/private/tmp/ds9-worktrees/151` (git worktree)

**Watcher spawn mechanism:**
- `bridge/watcher.js` spawns `claude -p` workers via `execFile` (line ~1509) with `cwd: worktreePath` (the per-slice worktree at `/private/tmp/ds9-worktrees/slice/<id>/`).
- No uid override — the child process inherits the parent's uid.
- This means O'Brien (Cowork session) and Rom (claude -p worker) run under the **same OS uid** (501/phillyvanilly).

**Implication:** Same-uid means `chmod -w` enforcement works — it blocks O'Brien's Write/Edit tool calls on locked paths. Rom's worktree is a separate checkout at `/private/tmp/` and is unaffected by main's permission changes. The pre-commit hook distinguishes main vs worktree by comparing `--git-dir` to `--git-common-dir`.

## What was implemented

### Layer 1 — Pre-commit hook (`scripts/hooks/pre-commit`)
- Detects whether the commit is in the main working tree or a worktree by comparing `git rev-parse --git-dir` vs `--git-common-dir`.
- In the main working tree: rejects the commit unless `DS9_WATCHER_MERGE=1` is set.
- In a worktree: allows the commit unconditionally.
- Installed via `scripts/install-hooks.sh` → `git config core.hooksPath scripts/hooks`.

### Layer 2 — Filesystem lock (`scripts/lock-main.sh` / `scripts/unlock-main.sh`)
- `lock-main.sh` removes write permissions on: `dashboard/`, `docs/contracts/`, `bridge/*.js`, `package.json`, `README.md`, `CLAUDE.md`.
- `unlock-main.sh` restores owner-write permissions on the same paths.
- Paths NOT locked: `bridge/staged/`, `bridge/queue/`, `bridge/trash/`, `.auto-memory/`, `.claude/`.

### Watcher wiring (`bridge/watcher.js` — `mergeBranch` function)
- Before the merge try-block: calls `scripts/unlock-main.sh` and sets `process.env.DS9_WATCHER_MERGE = '1'`.
- In the `finally` block: deletes `DS9_WATCHER_MERGE` from env and calls `scripts/lock-main.sh`.
- The existing merge logic (worktree merge → update-ref → file sync → read-tree → push) is unchanged.

### Documentation
- New `## Code-write enforcement` section added to `CLAUDE.md` describing both layers.

## Verification

- `scripts/install-hooks.sh` run successfully; `git config core.hooksPath` returns `scripts/hooks`.
- `node -c bridge/watcher.js` exits 0.
- `node -c bridge/new-slice.js` exits 0.
- All four scripts are `chmod +x`.
- This worktree commit succeeds because the hook correctly identifies worktree context (git-dir ≠ git-common-dir).

## Action required by Philipp

After merging this branch to main, run `scripts/lock-main.sh` once to activate Layer 2 (filesystem read-only enforcement). Until then, only Layer 1 (pre-commit hook) is active.

## Files changed

- `scripts/hooks/pre-commit` (added)
- `scripts/install-hooks.sh` (added)
- `scripts/lock-main.sh` (added)
- `scripts/unlock-main.sh` (added)
- `bridge/watcher.js` (modified — unlock/lock wrapper + DS9_WATCHER_MERGE env var around mergeBranch)
- `.claude/CLAUDE.md` (modified — new Code-write enforcement section)
- `bridge/queue/151-DONE.md` (added — this report)
