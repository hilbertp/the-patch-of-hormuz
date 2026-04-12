---
id: "041"
title: "Unmerged accepted branch alert"
goal: "Philipp gets a visible, human-readable alert whenever an accepted commission branch was not merged."
from: kira
to: obrien
priority: high
created: "2026-04-09T20:30:00Z"
references: null
timeout_min: null
status: "PENDING"
---

## Objective

When a commission is accepted, the watcher merges its branch immediately via `mergeBranch()`. If that merge fails (or if an ACCEPTED file exists on startup with no corresponding MERGED event in the register), Philipp must be alerted clearly — not buried in logs.

Currently a merge failure writes a MERGE_FAILED register event and a log line, but nothing forces it into Philipp's attention.

## Two alert surfaces to add

### 1. Startup scan (crash recovery extension)

In `crashRecovery()` in `bridge/watcher.js`, after handling orphaned IN_PROGRESS and EVALUATING files, add:

Scan queue directory for `*-ACCEPTED.md` files. For each one, check `register.jsonl` for a MERGED or MERGE_FAILED event with that commission ID.

- If MERGED event exists: branch already on main, no alert needed.
- If MERGE_FAILED event exists OR no merge event at all: print a loud human-readable alert to stdout and log it.

Alert format:
```
⚠️  UNMERGED BRANCH — Philipp action required
    Commission {id}: {title}
    Branch: {branch}
    Status: ACCEPTED but not merged to main
    Fix: git merge --no-ff {branch} && git push origin main
```

Print one block per unmerged ACCEPTED commission.

### 2. Live merge failure alert

In `mergeBranch()` (called from `handleAccepted()`), when the merge or push fails, in addition to writing the MERGE_FAILED register event, print:

```
⚠️  MERGE FAILED — Philipp action required
    Commission {id}: {title}
    Branch: {branch}
    Error: {error message}
    Fix: git merge --no-ff {branch} && git push origin main
```

Use `console.error` or the existing `print()` function — it must appear in the terminal, not just in bridge.log.

## Constraints

- Alerts must be visible in the terminal (stdout/stderr), not only in bridge.log.
- The ⚠️ emoji prefix makes them grep-able and visually distinct.
- Do not change evaluation logic, queue lifecycle, or register format.
- The Fix line gives Philipp the exact command to run — no detective work required.

## Success Criteria

- [ ] On startup, if any ACCEPTED file has no MERGED event in register, alert is printed to stdout
- [ ] Alert includes commission ID, title, branch name, and the exact git fix command
- [ ] When `mergeBranch()` fails, alert is printed immediately to terminal (not just logged)
- [ ] Alert format matches the specified blocks above
- [ ] Normal operation (no unmerged ACCEPTEDs) produces no extra output
