# Slice Lifecycle — Business Requirements

This document defines what the slice pipeline **must do**, independent of how watcher.js, server.js, or the dashboard currently implement it. When code diverges from this document, the code is wrong.

---

## Core principle

A slice is a moving Kanban ticket. It lives in **one place at one time** and is moved by **the intended actor** for the state it's transitioning out of.

One file per slice. The filename suffix IS the status. No parallel lifecycles, no sidecar files that represent a different phase of the same ticket.

---

## Actors

| Role        | Responsibility                                                                 |
|-------------|-------------------------------------------------------------------------------|
| Philipp     | Product owner. Approves slices into the queue.                                 |
| O'Brien     | Dev team lead. Sole author of slices. Escalation point when Rom–Nog loop fails.|
| Rom         | Implementor. Moves the ticket from IN_PROGRESS to DONE. On rejection, reads Nog's appendment and reworks his implementation. |
| Nog         | Code reviewer. **Append-only.** Writes his verdict and findings below existing content and hands the ticket back — to Rom (if cycles ≤ 5) or to O'Brien (escalation). Never edits what Rom or O'Brien wrote. |
| Watcher     | Technical orchestrator. Physical filesystem moves, git ops, role spawning.      |

The watcher does **not** approve, accept, or reject. It executes transitions that the human/role actors decide.

---

## States (in order)

1. **STAGED** — O'Brien has drafted the slice. Awaiting Philipp's approval in the Ops Center.
2. **QUEUED** — Approved by Philipp. Waiting for Rom to pick up.
3. **IN_PROGRESS** — Rom is implementing.
4. **DONE** — Rom has finished. Awaiting Nog's review.
5. **IN_REVIEW** — Nog is evaluating quality, ACs, and goal achievement.
6. **ACCEPTED** — Nog has passed the slice. Awaiting merge.
7. **MERGED** — Merge commit on main. Awaiting archive.
8. **ARCHIVED** — Terminal success state. Read-only history.

---

## State transitions — who moves the ticket

| From          | To                        | Moved by | Trigger                                              |
|---------------|---------------------------|----------|------------------------------------------------------|
| —             | STAGED                    | O'Brien  | Drafts the slice file.                               |
| STAGED        | QUEUED                    | Server   | Philipp clicks Approve in the Ops Center.            |
| QUEUED        | IN_PROGRESS               | Watcher  | Picks up next PENDING, sets up worktree, spawns Rom. |
| IN_PROGRESS   | DONE                      | Rom      | Writes his completion report.                        |
| DONE          | IN_REVIEW                 | Watcher  | Hands the slice to Nog.                              |
| IN_REVIEW     | ACCEPTED                  | Nog      | Appends verdict: ACs met and goal achieved.          |
| IN_REVIEW     | QUEUED                    | Nog      | Appends rejection verdict + findings. Cycle count ≤ 5. Rom will rework his implementation on next pickup. |
| IN_REVIEW     | STAGED (via O'Brien)      | Nog → O'Brien | Appends 6th rejection verdict. O'Brien reworks the slice and returns it to STAGED. |
| ACCEPTED      | MERGED                    | Watcher  | `git merge --no-ff slice/NNN-*` + `git push origin main`. |
| MERGED        | ARCHIVED                  | Watcher  | Post-push bookkeeping — worktree prune, branch delete, file renamed to terminal state. |

---

## Rejection flow

The purpose of Nog is to catch problems before merge. **Nog only appends.** He adds his verdict below existing content and hands the ticket back to the next actor.

1. Nog evaluates the slice in IN_REVIEW.
2. If ACs aren't met OR the goal isn't achieved, Nog **appends** a rejection verdict below the existing slice content. The verdict describes what was wrong and where Rom deviated from expectations. Nog does not edit, delete, or rewrite anything above his appended block.
3. The slice returns to QUEUED with Nog's appendment attached. Rom picks it up again, reads Nog's findings at the bottom of the file, and **reworks his implementation** (in the code, on the slice branch) to address them. The slice file itself is never edited — only appended to.
4. In the rework path, the Rom–Nog cycle may repeat **up to 5 times**. Each of Nog's rejection verdicts is appended to the file; prior rounds remain visible as audit trail.
5. If Rom still fails after 5 rework rounds (i.e., Nog writes a 6th rejection verdict), the slice is **handed to O'Brien**. Nog routes the ticket to O'Brien, not back to Rom.
6. O'Brien reads the full appendment history and reviews why Rom couldn't satisfy the ACs. Possible outcomes:
   - The ACs were unclear or contradictory — O'Brien clarifies the slice.
   - The slice was too large — O'Brien splits it.
   - The goal was wrong or unachievable — O'Brien rewrites.
7. After O'Brien's rework, the slice returns to STAGED for Philipp's re-approval.

---

## Invariants (enforced by the pipeline)

1. **One file per slice.** One location, one suffix, at any moment. No parallel spec-file / report-file split that implies two lifecycles.
2. **Merge strictly after ACCEPTED.** Never before.
3. **Archive strictly after MERGED.** Never before.
4. **Each actor only moves the ticket out of the state they own.** Rom doesn't accept. Nog doesn't merge. Watcher doesn't approve.
5. **The slice file is append-only after it leaves STAGED.** No actor edits or deletes prior content. Nog appends his verdict; Rom reworks his code on the slice branch (not the file); O'Brien only rewrites a slice when he pulls it back to STAGED.
6. **The ticket's history is auditable from the filesystem alone.** `ls bridge/queue/` and the register tell the full story; no hidden state in memory. Each rejection round is visible as an appended block on the slice file.
7. **Rejection does not lose work.** The slice branch survives the rejection loop; only the slice file moves back to QUEUED.
8. **Escalation to O'Brien is automatic after 5 failed Nog rounds.** Not optional.

---

## What this document is and isn't

**Is:** the source of truth for what the pipeline must do. Every technical artifact — watcher.js, server.js, role prompts, skill definitions, diagrams — must reflect this.

**Isn't:** a technical specification. Filesystem layout, file suffix names, API endpoints, git mechanics, and role-spawning plumbing are implementation concerns. They may change. The business flow above does not.

When reviewing any lifecycle artifact (diagram, skill, role description, code), check it against this document. If they disagree, this document wins and the artifact must be corrected.

---

## Known code divergences to investigate (not part of the requirements — flagged for triage)

These are surfaced here so they don't get lost. They are **not** how the pipeline should work:

- `bridge/watcher.js` line ~1826 renames IN_PROGRESS → ARCHIVED *before* Nog evaluates. The comment claims this is to "archive the original slice so Nog's evaluation task can find the success criteria," which suggests the suffix ARCHIVED is being reused for a "park-the-file" purpose that has nothing to do with the terminal ARCHIVED state in this document. Either the rename target should be a different suffix (e.g. `-PARKED.md`), or the behavior should be removed entirely. This creates a naming collision with the real terminal state.
- The `-REVIEWED.md` suffix (line ~2446) has no documented place in the business flow. Either it has a legitimate role (a sidecar artifact Nog writes alongside the verdict) that needs to be documented, or it is dead code and should be removed.

These are candidates for their own slices once the BR document is ratified.
