---
id: "061"
title: "Fix mergeBranch — stash runtime files before git checkout"
goal: "Accepted commissions merge to main without failing due to dirty heartbeat.json or register.jsonl."
from: kira
to: obrien
priority: high
created: "2026-04-12T00:00:00Z"
references: null
timeout_min: 10
branch: "fix/61-merge-dirty-files"
status: "PENDING"
---

## The bug

`mergeBranch()` in `bridge/watcher.js` runs `git checkout main` before merging. The watcher writes to `bridge/heartbeat.json` and `bridge/register.jsonl` continuously during operation. These files are always dirty when a merge is attempted. Git refuses to switch branches over dirty tracked files, so every merge fails with:

```
error: Your local changes to the following files would be overwritten by checkout:
        bridge/heartbeat.json
        bridge/register.jsonl
```

## The fix

In `mergeBranch()` (around line 1080 in `bridge/watcher.js`), stash `heartbeat.json` and `register.jsonl` before the checkout, then restore them after.

Find the current `mergeBranch` function body:

```js
function mergeBranch(id, branchName, title) {
  const commitMsg = `merge: ${branchName} — ${title || `commission ${id}`} (commission ${id})`;
  try {
    execSync('git checkout main', { cwd: PROJECT_DIR, stdio: 'pipe' });
    execSync(`git merge --no-ff ${branchName} -m "${commitMsg.replace(/"/g, '\\"')}"`, { cwd: PROJECT_DIR, stdio: 'pipe' });
    const sha = execSync('git rev-parse HEAD', { cwd: PROJECT_DIR, encoding: 'utf-8' }).trim();
    try {
      execSync('git push origin main', { cwd: PROJECT_DIR, stdio: 'pipe' });
    } catch (pushErr) {
      log('warn', 'merge', { id, msg: 'git push origin main failed (merge succeeded locally)', error: pushErr.message });
    }
    return { success: true, sha, error: null };
  } catch (err) {
    try { execSync('git merge --abort', { cwd: PROJECT_DIR, stdio: 'pipe' }); } catch (_) {}
    return { success: false, sha: null, error: err.stderr ? err.stderr.toString().trim() : err.message };
  }
}
```

Replace with:

```js
function mergeBranch(id, branchName, title) {
  const commitMsg = `merge: ${branchName} — ${title || `commission ${id}`} (commission ${id})`;
  // heartbeat.json and register.jsonl are written by the watcher continuously and
  // will always be dirty. Stash them before switching branches, restore after.
  const RUNTIME_FILES = ['bridge/heartbeat.json', 'bridge/register.jsonl'];
  let stashed = false;
  try {
    try {
      execSync(`git stash -- ${RUNTIME_FILES.join(' ')}`, { cwd: PROJECT_DIR, stdio: 'pipe' });
      stashed = true;
    } catch (_) {
      // Files may not be dirty — stash is best-effort
    }
    execSync('git checkout main', { cwd: PROJECT_DIR, stdio: 'pipe' });
    execSync(`git merge --no-ff ${branchName} -m "${commitMsg.replace(/"/g, '\\"')}"`, { cwd: PROJECT_DIR, stdio: 'pipe' });
    const sha = execSync('git rev-parse HEAD', { cwd: PROJECT_DIR, encoding: 'utf-8' }).trim();
    if (stashed) {
      try { execSync('git stash pop', { cwd: PROJECT_DIR, stdio: 'pipe' }); } catch (_) {}
    }
    try {
      execSync('git push origin main', { cwd: PROJECT_DIR, stdio: 'pipe' });
    } catch (pushErr) {
      log('warn', 'merge', { id, msg: 'git push origin main failed (merge succeeded locally)', error: pushErr.message });
    }
    return { success: true, sha, error: null };
  } catch (err) {
    try { execSync('git merge --abort', { cwd: PROJECT_DIR, stdio: 'pipe' }); } catch (_) {}
    if (stashed) {
      try { execSync('git stash pop', { cwd: PROJECT_DIR, stdio: 'pipe' }); } catch (_) {}
    }
    return { success: false, sha: null, error: err.stderr ? err.stderr.toString().trim() : err.message };
  }
}
```

## Also: merge the stuck branches

After fixing `mergeBranch`, manually trigger merges for the two accepted-but-unmerged branches:
- `slice/57-unified-timesheet` (commissions 057, 059)
- `fix/60-timer-anchor` (commission 060)

Run in the repo:
```
git stash -- bridge/heartbeat.json bridge/register.jsonl
git checkout main
git merge --no-ff slice/57-unified-timesheet -m "merge: slice/57-unified-timesheet — unify timesheet (commission 057/059)"
git merge --no-ff fix/60-timer-anchor -m "merge: fix/60-timer-anchor — timer anchor fix (commission 060)"
git stash pop
```

Commit the watcher fix itself on `fix/61-merge-dirty-files`, then these manual merges go directly to main.

## Constraints

- Branch: `fix/61-merge-dirty-files`
- Touch only `bridge/watcher.js`
- The manual merges above go directly to main (they are already accepted work)

## Success criteria

1. `mergeBranch()` stashes `bridge/heartbeat.json` and `bridge/register.jsonl` before `git checkout main`
2. Stash is popped after merge (success or failure)
3. `slice/57-unified-timesheet` and `fix/60-timer-anchor` are merged to main
4. DONE report includes all 5 metrics fields with real non-null values
