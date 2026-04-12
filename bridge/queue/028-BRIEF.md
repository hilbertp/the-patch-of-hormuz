---
id: "028"
title: "Resolve merge conflict: slice/26-evaluator into main"
goal: "The evaluator code lands on main with no conflicts and the watcher can be restarted."
from: kira
to: obrien
priority: spike
created: "2026-04-09T03:10:00Z"
references: "027"
type: amendment
branch: "slice/26-evaluator"
timeout_min: null
---

## Objective

The merge of `slice/26-evaluator` into main failed with a conflict in `dashboard/server.js`. The conflict is trivially resolvable with the instructions below. Rebase the branch onto main, apply the resolution, and merge.

## Conflict analysis

`main`'s `dashboard/server.js` has:
```js
const REGISTER   = path.join(REPO_ROOT, 'bridge', 'register.jsonl');
```

`slice/26-evaluator` renamed this to `REGISTER_FILE` and added `CORS_ORIGIN`. The branch also added the `POST /api/bridge/review` route which main does not have.

## Resolution instructions

1. Check out `slice/26-evaluator` and rebase onto main:
   ```
   git checkout slice/26-evaluator
   git rebase main
   ```

2. When the conflict surfaces in `dashboard/server.js`, resolve the constants block to:
   ```js
   const PORT         = process.env.DASHBOARD_PORT ? parseInt(process.env.DASHBOARD_PORT, 10) : 4747;
   const HOST         = process.env.DASHBOARD_HOST ?? '0.0.0.0';
   const REPO_ROOT    = path.resolve(__dirname, '..');
   const QUEUE_DIR    = path.join(REPO_ROOT, 'bridge', 'queue');
   const HEARTBEAT    = path.join(REPO_ROOT, 'bridge', 'heartbeat.json');
   const REGISTER     = path.join(REPO_ROOT, 'bridge', 'register.jsonl');
   const DASHBOARD    = path.join(__dirname, 'lcars-dashboard.html');

   const CORS_ORIGIN  = 'https://dax-dashboard.lovable.app';
   ```
   Key decisions:
   - Keep `REGISTER` (main's name), not `REGISTER_FILE` (branch's name)
   - Update all references to `REGISTER_FILE` in the branch code to `REGISTER`
   - Add `CORS_ORIGIN` constant after the existing block

3. Ensure the `POST /api/bridge/review` handler (from the branch) uses `REGISTER` not `REGISTER_FILE` in its `fs.appendFileSync` call.

4. Continue the rebase, commit, then merge to main:
   ```
   git rebase --continue
   git checkout main
   git merge slice/26-evaluator
   git push origin main
   ```

## Constraints

- Do not drop any code from either side — the goal is additive: main's register/review work + branch's evaluator additions
- `CORS_ORIGIN` must match exactly: `'https://dax-dashboard.lovable.app'`
- Use `REGISTER` (not `REGISTER_FILE`) throughout the merged file

## Success Criteria

- [ ] `slice/26-evaluator` rebased onto main with no remaining conflicts
- [ ] `dashboard/server.js` on main contains `CORS_ORIGIN` constant and `POST /api/bridge/review` endpoint
- [ ] All references to `REGISTER_FILE` replaced with `REGISTER`
- [ ] `bridge/watcher.js` evaluator code present on main
- [ ] `git log --oneline main` shows evaluator commits
- [ ] origin/main is up to date
- [ ] DONE report includes final commit SHA on main
