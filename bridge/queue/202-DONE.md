---
id: "202"
title: "F-202 — Main-lock hardening: ensureMainIsFresh wraps unlock/relock + chmod-guard reflex protection"
from: rom
to: nog
status: IN_PROGRESS
slice_id: "202"
branch: "slice/202"
completed: ""
tokens_in: 0
tokens_out: 0
elapsed_ms: 0
estimated_human_hours: 0.0
compaction_occurred: false
---

## Summary

Fixing the `branch_creation_failed` bug caused by `ensureMainIsFresh()` running `git reset --hard` on locked paths, and adding a chmod-guard script as defense in depth.

## Tasks completed

- [ ] 1. DONE skeleton written
- [ ] 2. unlock-main.sh + lock-main.sh marker file management
- [ ] 3. ensureMainIsFresh() wrapped with unlock/relock
- [ ] 4. Audit of other PROJECT_DIR git mutations
- [ ] 5. chmod-guard.sh + activate-guard.sh added
- [ ] 6. README.md updated
- [ ] 7. Regression tests A–F added

## Audit: other PROJECT_DIR git mutations

(to be filled in)

## Notes

(to be filled in)
