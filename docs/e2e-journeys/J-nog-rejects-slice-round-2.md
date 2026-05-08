---
id: J-nog-rejects-slice-round-2
category: review-verdict
status: draft
last_reviewed: 2026-05-08
---

# Nog rejects a slice and Rom reworks it (Round 2)

## What the user is trying to accomplish

Nog finds unsatisfied acceptance criteria or goal misalignment, appends a rejection verdict with detailed findings, and the slice returns to Rom for rework. Rom picks it up again, reads Nog's feedback, and commits fixes on the same branch.

## Preconditions

- A slice is in the DONE state (Rom just completed Round 1)
- The slice contains a valid Rom DONE Report but one or more ACs are unmet or the goal is not achieved
- Nog has been invoked and reviewed the slice (all five phases)
- Nog has determined the round cap is not yet exhausted (round < 5)

## Steps

1. Nog runs all five phases as in J-nog-accepts-slice
2. Nog finds that Phase 4 (AC check) fails: "AC #2 requires function X to return Y, but the diff returns Z"
3. Nog outputs verdict: `REJECTED` with detailed reason
4. The orchestrator appends a `## Nog Review — Round 1` block with the rejection reason
5. The orchestrator renames the slice file: `bridge/queue/XXX-DONE.md` → `bridge/queue/XXX-QUEUED.md`
6. The orchestrator increments the `round` counter in the slice frontmatter: `round: 2`
7. The orchestrator emits a `NOG_DECISION{verdict: REJECTED, round: 1, reason: ...}` event
8. The Ops Center dashboard animates the slice from Pipeline lane → back to the Queue (approved-queue group)
9. The orchestrator's next poll cycle picks up the slice again and spawns Rom with the updated slice file
10. Rom reads the full slice file, sees Nog's review block at the bottom, understands the feedback
11. Rom commits a new round of fixes on the `slice/XXX-<slug>` branch, addressing the failed AC
12. Rom appends a new `## Rom DONE Report — Round 2` block documenting the fixes
13. Rom signals DONE again; the cycle repeats (orchestrator → Nog → verdict)

## Expected outcomes

- Slice file contains two appended blocks: `## Nog Review — Round 1` + `## Rom DONE Report — Round 2`
- Frontmatter field `round: 2` is updated
- Register contains two events: first `NOG_DECISION{verdict: REJECTED, round: 1}`, then second `DONE` event with `round: 2`
- Dashboard slice moves from Pipeline → Queue visually
- The slice's row in the Queue shows a `MAX ROUNDS` badge or counter indicator (if round count is surfaced)
- Rom's branch has new commits on top of the prior Round 1 work
- No files are deleted or rewritten; the slice file is append-only

## Known failure modes

- **Nog verdict is unclear or contradictory.** Rom may not understand what to fix. *Recovery:* The reason field should be specific; if it's not, O'Brien should review and clarify the slice ACs before the next round.
- **Rom makes changes that don't address the feedback.** Nog may reject again for the same reason. *Recovery:* This results in a Round 3. If the cycle repeats 5+ times, it escalates to O'Brien.
- **Round counter doesn't increment.** The orchestrator may have a bug in updating the frontmatter. *Recovery:* Manually edit the `round` field in the frontmatter and signal DONE again.
- **Slice file becomes unreadable due to many appended blocks.** The file grows large and slow to parse. *Recovery:* This is expected behavior; archive the slice after merge to keep queue files lean.

## Sources

- `docs/architecture/NOG-GATE-ADR.md` — rejection verdict and phase 4 logic
- `docs/architecture/LIFECYCLE-NAMES-ADR.md` — `REJECTED` verdict, QUEUED state
- `docs/contracts/slice-format.md` — Nog Review block format, appended Rom report blocks
- `docs/contracts/slice-lifecycle.md` — rejection flow and round counter semantics
- `repo/.claude/roles/obrien/inbox/HANDOFF-OPS-REDESIGN-SPEC-FROM-ZIYAL.md` — Queue panel motion, reordering

## Open questions

- When Rom reads Nog's review block, is it the full block as appended, or a parsed summary extracted by the orchestrator? If it's the full block, are there line-wrapping / readability concerns?
- Does the round counter in the frontmatter reflect "which round was just completed" or "which round we're about to start"? (Matters for indexing.)
- If Rom makes no changes and appends a blank DONE report for Round 2, will Nog immediately reject again? Should the orchestrator warn Rom if the branch has no new commits since the last DONE?
