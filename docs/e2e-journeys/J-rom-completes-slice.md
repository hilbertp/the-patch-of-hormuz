---
id: J-rom-completes-slice
category: dispatch-execution
status: draft
last_reviewed: 2026-05-08
---

# Rom completes a slice and transitions to code review

## What the user is trying to accomplish

Rom implements a slice in a worktree, runs local validation, writes a completion report (DONE block) appended to the slice file, and hands it off to Nog for review.

## Preconditions

- A slice is in IN_PROGRESS state (Rom is working on it)
- Rom has a clean worktree and has been implementing the ACs
- The slice file exists at `bridge/queue/XXX-IN_PROGRESS.md`
- Rom's local branch is `slice/XXX-<slug>`

## Steps

1. Rom implements the slice's ACs on the `slice/XXX-<slug>` branch, committing regularly
2. Rom runs local validation (linting, tests if applicable, diff review)
3. Rom appends a `## Rom DONE Report — Round 1` block to the slice file with:
   - Summary of what was implemented
   - Key changes per file
   - Any manual validation results
   - Any uncertainties or edge cases noted for Nog
4. Rom commits the slice file update on the branch
5. Rom (or the orchestrator's dispatch loop) signals that the work is DONE
6. The orchestrator renames the slice file: `bridge/queue/XXX-IN_PROGRESS.md` → `bridge/queue/XXX-DONE.md`
7. The orchestrator emits a `DONE` event to the register
8. The Ops Center dashboard receives the event and animates the slice from Active Build panel → Pipeline (Nog lane)

## Expected outcomes

- Slice file contains the appended DONE report with author, timestamp, and detailed work summary
- Register contains a `DONE` event with `round: 1` and the slice ID
- File suffix changes from `-IN_PROGRESS.md` to `-DONE.md` atomically
- Dashboard slice card animates from Active Build → Nog's lane in the Pipeline panel
- Rom's branch remains available for Nog's diff review
- Pipeline panel shows the slice in Nog's lane with status "idle" (awaiting review)
- Orchestrator picks up the next QUEUED slice (if any) in the next poll cycle

## Known failure modes

- **Orchestrator doesn't detect the DONE report.** Rom may have written the block but the orchestrator's watcher isn't polling for it. *Recovery:* Check that `bridge/watcher.js` (or `orchestrator.js`) has a finite poll interval (typically <30s) for detecting DONE blocks. Manually trigger the transition by invoking the rename.
- **Slice file is locked or unwritable.** The orchestrator may have the file open for reading. *Recovery:* Check file permissions. Verify the orchestrator is not holding an exclusive lock on the queue directory.
- **DONE report is malformed or incomplete.** Rom may have appended a block with missing required fields (summary, timestamp). *Recovery:* Nog's parser should be lenient; but if it fails, Rom should re-append the block with all required fields.
- **Rom's branch has merge conflicts with dev.** When Nog approves and the orchestrator tries to squash-merge the branch to dev, conflicts occur. *Recovery:* This is caught in the next journey (Nog review). For now, the expectation is that Rom rebased on dev before writing DONE.

## Sources

- `docs/contracts/slice-format.md` — DONE Report block format and required fields
- `docs/contracts/slice-lifecycle.md` — DONE state definition and transition
- `docs/architecture/LIFECYCLE-NAMES-ADR.md` — `DONE` event contract
- `repo/.claude/roles/obrien/inbox/HANDOFF-OPS-REDESIGN-SPEC-FROM-ZIYAL.md` — Active Build panel, Pipeline panels, motion primitives
- `bridge/orchestrator.js` — state-watcher and file-rename logic

## Open questions

- Is Rom's DONE block appended while Rom is still "active" on the slice, or after Rom has explicitly "released" the worktree? The distinction matters for concurrency — if Rom is still free to push more commits after appending DONE, does that invalidate Nog's review?
- The spec mentions "optional: any uncertainties or edge cases noted for Nog" — are these fields actually optional, or should Nog's prompt warn if they're missing?
- Does the orchestrator validate the DONE block format (e.g., check that frontmatter fields are correct) before renaming the file, or does it rename unconditionally?
