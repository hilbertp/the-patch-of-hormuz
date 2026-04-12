---
id: "037"
title: "Merge on accept: remove merge commissions, merge in-process"
goal: "When a commission is accepted, O'Brien merges the branch immediately — no separate merge commission is created."
from: kira
to: obrien
priority: high
created: "2026-04-09T19:40:00Z"
references: null
timeout_min: null
---

## Objective

Currently, when the evaluator accepts a commission, it creates a new `{nextId}-PENDING.md` merge commission and O'Brien picks it up as a separate queue item. This is wrong: it adds noise to the queue, inflates commission IDs, and makes the history hard to read.

The correct behaviour: when a commission is ACCEPTED, the evaluator calls `git merge` directly (via a shell exec in `watcher.js`), without creating a new queue commission. The merge is part of the acceptance step, not a separate commissioned task.

## Design

In `handleAccepted()` in `bridge/watcher.js`:

**Remove:**
- Writing of `{nextId}-PENDING.md` merge commission file
- `nextCommissionId()` call for merge ID

**Add:**
- Shell exec: `git checkout main && git merge --no-ff {branch} -m "merge: {branch} — {title} (commission {id})" && git push origin main`
- On success: log merge commit SHA, write register event `MERGED` with branch and SHA
- On failure: log error, write register event `MERGE_FAILED` with reason — do NOT retry automatically, surface to operator

**Branch naming convention (enforce going forward):**
- O'Brien's commission template (`.claude/CLAUDE.md` or commission prompt) must instruct O'Brien to always use `slice/{id}-{short-title}` as the branch name. Read the branch from the DONE report frontmatter `branch:` field. If missing, log a warning and skip the merge.

**Crash recovery:**
- If the watcher crashes between ACCEPTED rename and merge exec, the ACCEPTED file will exist but no merge will have happened. On recovery: scan for ACCEPTED files, check if their branch is already on main (via `git branch --merged main`), if not, re-attempt merge.

## Constraints

- Do not change the PENDING → IN_PROGRESS → DONE evaluation flow.
- Merge commissions (type: merge) currently in the queue should still be handled — but `handleAccepted()` should no longer GENERATE them for new work.
- Do not break the existing `type: merge` detection logic (used to auto-accept merge commissions). Remove or deprecate it cleanly once no merge commissions will be generated.

## Success Criteria

- [ ] `handleAccepted()` performs `git merge` and `git push` directly, no new PENDING file created
- [ ] Register event `MERGED` written with branch, SHA, and commission ID on success
- [ ] Register event `MERGE_FAILED` written with reason on failure
- [ ] Terminal output shows merge result inline: "✓ ACCEPTED · Merged {branch} → main ({sha})" or "✗ Merge failed: {reason}"
- [ ] O'Brien's commission prompt (in CLAUDE.md or watcher commission template) instructs branch naming: `slice/{id}-{short-title}`
- [ ] Crash recovery handles orphaned ACCEPTED files by re-attempting merge if branch not yet on main
- [ ] No new merge commissions appear in the queue for future accepted work
