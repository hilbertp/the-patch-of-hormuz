# Git Strategy — Liberation of Bajor

## The Problem

The repo lives on a FUSE mount. FUSE allows `write`, `rename`, and `read` but
**blocks `unlink` (delete)**. Git's `checkout` command uses `unlink` internally
to replace tracked files when switching branches. This means:

- `git checkout main` silently fails whenever files differ between branches.
- The watcher's pre-invocation checkout leaves stale branch files on disk.
- Disk state diverges from git state, causing feature regressions.

Additionally, Chief O'Brien (Cowork sessions) edits files directly on disk.
If those edits aren't committed before the watcher runs, they're either lost
(checkout succeeds and overwrites) or left orphaned (checkout fails, stale mix).

## The Rules (immutable)

### 1. FUSE-safe checkout — never rely on `git checkout`

The watcher uses `fuseSafeCheckoutMain()` instead of `git checkout main`.
This function:

1. Auto-commits any dirty tracked files to the current branch (so nothing is lost).
2. Gets the list of files differing between the current branch and main.
3. Overwrites each file on disk using `fs.writeFileSync` (truncate-in-place — FUSE-safe).
4. Moves HEAD pointer via `git symbolic-ref HEAD refs/heads/main`.
5. Resets the index via `git read-tree main`.
6. Verifies HEAD is `main`.

### 2. Auto-commit before processing

Before every slice invocation or merge, `autoCommitDirtyTree()` commits any
modified tracked files to the current branch. Uses `git add -u` (tracked files
only — no surprise additions of runtime files).

### 3. Post-merge verification

After every merge, `verifyWorkingTreeMatchesMain()` diffs the working tree
against HEAD. Any files that don't match are overwritten from git. This catches
FUSE-induced partial updates.

### 4. Branch name sanitization

Branch names from Rom's DONE report are untrusted input. `sanitizeBranchName()`
validates against `[a-zA-Z0-9._/-]` and rejects patterns like `..` or leading
`-` before any shell interpolation.

### 5. Main is the source of truth

- All direct edits (Chief O'Brien / Cowork sessions) must be committed to main.
- Feature branches exist only during Rom's execution.
- After merge, main must reflect all features — no work lives only on branches.

## What this replaces

| Before | After |
|--------|-------|
| `git checkout main` (line 604) | `fuseSafeCheckoutMain(id)` |
| `git checkout main` in `mergeBranch` | `fuseSafeCheckoutMain(id)` |
| No dirty-tree guard | `autoCommitDirtyTree()` before every operation |
| No post-merge check | `verifyWorkingTreeMatchesMain()` after every merge |
| Unsanitized branch names in shell | `sanitizeBranchName()` validation |

## Files modified

- `bridge/watcher.js` — all git safety functions live here, in the
  "Git safety layer" section between `updateFrontmatter` and `Heartbeat`.
