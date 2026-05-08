---
id: J-nog-accepts-slice
category: review-verdict
status: draft
last_reviewed: 2026-05-08
---

# Nog reviews and accepts a slice

## What the user is trying to accomplish

Nog reviews Rom's implementation against the acceptance criteria and goal, runs five review phases (lint, anti-pattern, team standards, AC check, goal sanity), and emits a verdict of ACCEPTED. The slice moves to awaiting merge.

## Preconditions

- A slice is in the DONE state (`bridge/queue/XXX-DONE.md`)
- The slice has a valid Rom DONE Report block with summary and changes
- Rom's branch (`slice/XXX-<slug>`) exists and has all implementation commits
- A diff exists between `main` and `slice/XXX-<slug>`
- Nog has been invoked by the orchestrator via a `claude -p` call

## Steps

1. The orchestrator detects DONE state and spawns Nog with the slice body, diff, and ACs
2. Nog reads the goal, ACs, and current round number
3. Nog runs Phase 1 (Lint): checks JavaScript syntax, Markdown frontmatter, JSON parsing
4. Nog runs Phase 2 (Anti-pattern): checks for eval, bare catch, hardcoded mocking, git ops outside orchestrator, direct queue writes
5. Nog runs Phase 3 (Team standards): checks against `.claude/roles/rom/TEAM-STANDARDS.md`, FUSE safety, worktree discipline
6. Nog runs Phase 4 (AC check): walks through each AC and judges if the diff satisfies it
7. Nog runs Phase 5 (Goal sanity): judges if the diff achieves the goal without overreach or underreach
8. Nog outputs the verdict: `ACCEPTED` with reason (short prose explaining the overall assessment)
9. The orchestrator receives the verdict, appends a `## Nog Review — Round 1` block to the slice file with the verdict and reason
10. The orchestrator renames the slice file: `bridge/queue/XXX-DONE.md` → `bridge/queue/XXX-ACCEPTED.md`
11. The orchestrator emits a `NOG_DECISION{verdict: ACCEPTED, reason: ...}` event to the register
12. The Ops Center dashboard animates the slice from Pipeline lane → History panel (top row, `ACCEPTED` outcome badge)

## Expected outcomes

- Slice file has an appended `## Nog Review — Round 1` block with verdict and reason
- Register contains a `NOG_DECISION` event with `verdict: ACCEPTED`, `round: 1`, and the prose reason
- File suffix changes from `-DONE.md` to `-ACCEPTED.md`
- Dashboard slice card animates from Nog lane → History panel
- History row shows outcome badge `ACCEPTED` (green, ok-bg color)
- Cost and duration are computed from slice frontmatter and displayed in the history row
- User can now press the Merge button in the Branch Topology panel (if this is the first or only slice in the batch)
- Orchestrator queues this slice for the next merge gate (user decision when to run the gate)

## Known failure modes

- **Nog cannot read the diff.** Rom may have deleted the branch or the diff path is malformed. *Recovery:* Check that `slice/XXX-<slug>` exists and `git diff main...slice/XXX-<slug>` returns output. If the branch is gone, recovery is O'Brien's responsibility — escalate.
- **Nog's verdict is REJECTED (not ACCEPTED).** Nog found an unsatisfied AC or a goal mismatch. *Recovery:* This is the expected rejection flow (see J-nog-rejects-slice journey). Rom will rework.
- **Nog outputs ESCALATE or OVERSIZED.** Nog cannot judge the slice or finds it too large. *Recovery:* The orchestrator routes the slice back to O'Brien for rework or splitting (see recovery journey).
- **Nog process times out.** The diff may be too large or Nog's context window is exhausted. *Recovery:* Nog should emit `OVERSIZED` before timing out; if it times out silently, the orchestrator should detect the hung process and abort.

## Sources

- `docs/architecture/NOG-GATE-ADR.md` — Nog invocation shape, five phases, verdict contract
- `docs/architecture/LIFECYCLE-NAMES-ADR.md` — `NOG_DECISION` event and `ACCEPTED` verdict
- `docs/contracts/slice-format.md` — Nog Review block format
- `docs/contracts/slice-lifecycle.md` — ACCEPTED state definition
- `repo/.claude/roles/nog/ROLE.md` — Nog's role definition and review discipline (if it exists)
- `repo/.claude/roles/obrien/inbox/HANDOFF-OPS-REDESIGN-SPEC-FROM-ZIYAL.md` — Pipeline panel (Nog lanes), History panel, motion primitives

## Open questions

- Does Nog receive prior round reviews when reviewing Round 2+? The NOG-GATE-ADR mentions "Prior round Nog reviews" as input, but is this for learning context only, or does it affect the verdict (e.g., does Nog check "did Rom address my prior findings")?
- The reason field is described as "short prose" — is there a length limit? Should it be 1 sentence or 2–3 sentences?
- When animating from Pipeline → History, does the history row appear at the top of the history panel, or does it slide in above all existing rows? The motion spec describes a "drag and resize" primitive, but History rows have a different layout than Pipeline lane cards.
