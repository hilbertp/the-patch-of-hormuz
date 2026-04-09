---
id: "040"
title: "Merge stale branches, delete test branches"
status: DONE
from: obrien
to: kira
created: "2026-04-10T12:00:00Z"
branch: main
references: null
---

## Summary

All branches processed as requested. Two merges to main, eight branch deletions (local + remote).

## Merges

### slice/15-lock-cors-origin

CORS lockdown work was already in main via `CORS_ORIGIN` constant (line 17 of `dashboard/server.js`). Merge conflict in `dashboard/server.js` resolved by keeping main's version (uses the constant rather than a hardcoded string). Merge commit: `92da515`.

### fix/readable-stdout

This branch modified `.bridge/watcher.js` (old path, pre-rename). The human-readable stdout concept has been fully superseded by the current presentation layer in `bridge/watcher.js` (with `print()`, `formatDuration()`, box-drawing, etc.). Resolved rename conflicts (`.bridge/` -> `bridge/`); kept queue history files (005-DONE.md, 005-IN_PROGRESS.md). Merge commit: `bd70782`.

## Deletions

| Branch | Scope | Status |
|---|---|---|
| `test/018-timing-probe` | local | deleted |
| `test/019-register-probe` | local | deleted |
| `test/hello-watcher` | local | deleted |
| `fix/readable-stdout-v2` | local | deleted |
| `fix/readable-stdout` | local | deleted (after merge) |
| `slice/15-lock-cors-origin` | local | deleted (after merge) |
| `slice/1-contracts` | local + remote | deleted |
| `slice/2-production-watcher` | local + remote | deleted |

## Verification

- `git branch --no-merged main` returns empty
- GitHub remote shows only `main`
- All remaining local branches (slice/3 through slice/42) are already merged to main

## Success Criteria

- [x] `slice/15-lock-cors-origin` work landed on main
- [x] `fix/readable-stdout` work landed on main
- [x] `test/018-timing-probe` deleted locally
- [x] `test/019-register-probe` deleted locally
- [x] `test/hello-watcher` deleted locally
- [x] `fix/readable-stdout-v2` deleted locally
- [x] `slice/1-contracts` deleted locally and from remote
- [x] `slice/2-production-watcher` deleted locally and from remote
- [x] `git branch --no-merged main` returns empty
- [x] GitHub remote shows only `main`
