---
id: "040"
title: "Merge stale branches, delete test branches"
goal: "All non-test unmerged branches are merged to main. Test branches are deleted."
from: kira
to: obrien
priority: high
created: "2026-04-09T20:30:00Z"
references: null
timeout_min: null
status: "PENDING"
---

## Objective

We have branches with real work that was never merged to main, and test branches whose purpose is concluded. Merge the real ones, delete the test ones.

## Context: remote vs local

GitHub shows only 3 remote branches: `main`, `slice/1-contracts`, `slice/2-production-watcher`. All other branches exist locally only — they were never pushed. This means remote cleanup is minimal; most work is local.

## Branches to MERGE to main (local only)

These were never pushed to remote. Merge locally then push main.

- `slice/15-lock-cors-origin` — CORS lockdown (commission 025). A version of this change may already be in main via a later commit; inspect the diff, apply any missing work, merge with `--no-ff`.
- `fix/readable-stdout` — human-readable stdout, predates the bridge rename (touches `.bridge/watcher.js`). Inspect diff carefully. Apply any changes not yet in `bridge/watcher.js` manually if a straight merge conflicts. The goal is to land any missing work, not necessarily a clean merge commit.

```
git checkout main
git merge --no-ff {branch} -m "merge: {branch} — backfill (commission 040)"
git push origin main
```

## Branches to DELETE — local only (test, work concluded)

- `test/018-timing-probe`
- `test/019-register-probe`
- `test/hello-watcher`

```
git branch -D {branch}
# no remote push needed — these were never pushed
```

## Branches to DELETE — local + remote (already merged, no work lost)

- `fix/readable-stdout-v2` — already merged to main. Local only.
- `slice/1-contracts` — merged to main, exists on remote (76 behind, 0 ahead).
- `slice/2-production-watcher` — merged to main, exists on remote (73 behind, 0 ahead).

```
git branch -D {branch}
git push origin --delete {branch}   # only slice/1 and slice/2 need this
```

## Success Criteria

- [ ] `slice/15-lock-cors-origin` work landed on main
- [ ] `fix/readable-stdout` work landed on main
- [ ] `test/018-timing-probe` deleted locally
- [ ] `test/019-register-probe` deleted locally
- [ ] `test/hello-watcher` deleted locally
- [ ] `fix/readable-stdout-v2` deleted locally
- [ ] `slice/1-contracts` deleted locally and from remote
- [ ] `slice/2-production-watcher` deleted locally and from remote
- [ ] `git branch --no-merged main` returns empty
- [ ] GitHub remote shows only `main`
