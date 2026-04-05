# Evaluation Rubric — Mara's Framework

Reference document for evaluating Rook's reports. Read alongside `MARA.md §G`.

---

## What "ACCEPTED" means

A report is **ACCEPTED** when all of the following are true:

1. **All success criteria are met** — every checkable condition in the commission's "Success criteria" section is satisfied.
2. **Deliverables exist on disk** — files listed in "Files changed" are present at the stated paths and contain the expected content.
3. **Work is committed on the correct branch** — Rook's changes are committed on the branch named in the commission (e.g. `slice/3-maras-half`), not on `main` or a prior branch.
4. **Report is written and committed** — the `{id}-DONE.md` file exists in `.bridge/queue/` and is committed to git.
5. **No open blockers** — "Blockers / Questions for Mara" section says "None." or all listed questions are answered within the report.

When all five hold: mark ACCEPTED and take no further action (unless you want to send an acknowledgment commission).

---

## What triggers AMENDMENT REQUIRED

Issue an amendment when any of the following apply:

| Trigger | Description |
|---|---|
| Partial work | One or more success criteria are not met, or files are missing |
| Wrong branch | Work committed on `main` or a prior branch instead of the specified slice branch |
| Missing commit | Files exist on disk but are not committed |
| Success criteria not met | Rook marked status `DONE` but your evaluation finds gaps |
| Status is `PARTIAL` | Rook explicitly declared partial completion |
| Status is `BLOCKED` | Rook needs a decision or answer before continuing |

In all cases: write an amendment commission (new ID, `references` pointing to the failing commission), describe exactly what needs to change or what answer Rook needs.

---

## Amendment vs. new commission

| | Amendment | New commission |
|---|---|---|
| **Use when** | Continuing or correcting prior work | New capability with no dependency on prior work |
| **`references` field** | Direct parent commission ID (e.g. `"003"`) | `null` |
| **Branch** | Same slice branch as parent (usually) | New `slice/{n}-{description}` branch |
| **Body focus** | What remains, what changed, or what decision Rook was waiting on | Full context for a fresh task |

If you're unsure: ask whether Rook should pick up from where he left off. If yes, it's an amendment. If the work is genuinely new and independent, it's a new commission.

---

## How to write an amendment

Full spec: `docs/contracts/commission-format.md`

Minimal frontmatter for an amendment:

```yaml
---
id: "005"
title: "Amendment: [brief description of what changed]"
from: mara
to: rook
priority: normal
created: "2026-04-06T12:00:00Z"
references: "004"
timeout_min: null
---
```

Body must include:
- What was incomplete or wrong in the prior commission's delivery
- What Rook must do now (specific, verifiable tasks)
- Updated success criteria (so Rook can self-evaluate before writing his report)
