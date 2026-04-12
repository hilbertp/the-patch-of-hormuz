# Evaluation Rubric — Kira's Framework

Reference document for evaluating O'Brien's reports. Read alongside `KIRA.md §G`.

---

## What "ACCEPTED" means

A report is **ACCEPTED** when all of the following are true:

1. **All success criteria are met** — every checkable condition in the brief's "Success criteria" section is satisfied.
2. **Deliverables exist on disk** — files listed in "Files changed" are present at the stated paths and contain the expected content.
3. **Work is committed on the correct branch** — O'Brien's changes are committed on the branch named in the brief (e.g. `slice/3-kiras-half`), not on `main` or a prior branch.
4. **Report is written and committed** — the `{id}-DONE.md` file exists in `bridge/queue/` and is committed to git.
5. **No open blockers** — "Blockers / Questions for Kira" section says "None." or all listed questions are answered within the report.

When all five hold: mark ACCEPTED and take no further action (unless you want to send an acknowledgment brief).

---

## What triggers AMENDMENT REQUIRED

Issue an amendment when any of the following apply:

| Trigger | Description |
|---|---|
| Partial work | One or more success criteria are not met, or files are missing |
| Wrong branch | Work committed on `main` or a prior branch instead of the specified slice branch |
| Missing commit | Files exist on disk but are not committed |
| Success criteria not met | O'Brien marked status `DONE` but your evaluation finds gaps |
| Status is `PARTIAL` | O'Brien explicitly declared partial completion |
| Status is `BLOCKED` | O'Brien needs a decision or answer before continuing |

In all cases: write an amendment brief (new ID, `references` pointing to the failing brief), describe exactly what needs to change or what answer O'Brien needs.

---

## Amendment vs. new brief

| | Amendment | New brief |
|---|---|---|
| **Use when** | Continuing or correcting prior work | New capability with no dependency on prior work |
| **`references` field** | Direct parent brief ID (e.g. `"003"`) | `null` |
| **Branch** | Same slice branch as parent (usually) | New `slice/{n}-{description}` branch |
| **Body focus** | What remains, what changed, or what decision O'Brien was waiting on | Full context for a fresh task |

If you're unsure: ask whether O'Brien should pick up from where he left off. If yes, it's an amendment. If the work is genuinely new and independent, it's a new brief.

---

## How to write an amendment

Full spec: `docs/contracts/brief-format.md`

Minimal frontmatter for an amendment:

```yaml
---
id: "005"
title: "Amendment: [brief description of what changed]"
from: kira
to: obrien
priority: normal
created: "2026-04-06T12:00:00Z"
references: "004"
timeout_min: null
---
```

Body must include:
- What was incomplete or wrong in the prior brief's delivery
- What O'Brien must do now (specific, verifiable tasks)
- Updated success criteria (so O'Brien can self-evaluate before writing his report)
