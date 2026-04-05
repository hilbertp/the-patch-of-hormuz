# Report Format — Bridge of Hormuz

*Contract version: 1.0*
*Source: PRD — Bridge of Hormuz v2.1, §5.3; Architecture v1.1*
*Author: Mara*
*Locked: 2026-04-06*

---

## Overview

A report is a markdown file with YAML frontmatter, written by Rook after executing a commission. Rook writes it to `{id}-DONE.md` in the queue directory before his process exits. Mara reads it to evaluate whether the commission is complete.

---

## DONE vs. ERROR distinction

This distinction is critical and must be understood by both Mara and Rook.

| File | Written by | Meaning |
|---|---|---|
| `{id}-DONE.md` | **Rook** | Rook executed the commission and produced a report. The report may say `DONE`, `PARTIAL`, or `BLOCKED` — but in all cases, Mara has something to evaluate. |
| `{id}-ERROR.md` | **The watcher** | The `claude -p` invocation itself failed — crash, timeout, non-zero exit with no report written by Rook. ERROR means infrastructure broke, not that Rook's work failed. |

**Rook always writes a DONE file.** Even if the commission cannot be completed (PARTIAL) or is stuck (BLOCKED), Rook writes a DONE file explaining the situation. Rook never writes an ERROR file — that is the watcher's sole responsibility.

---

## File naming

```
{id}-DONE.md
```

`{id}` matches the commission ID. **Examples:** `001-DONE.md`, `042-DONE.md`

---

## YAML frontmatter

### Required fields

| Field | Type | Description |
|---|---|---|
| `id` | string | Zero-padded three-digit ID matching the commission (e.g. `"003"`). Must be quoted. |
| `title` | string | Commission title, copied from the commission frontmatter. |
| `from` | string | Always `rook`. |
| `to` | string | Always `mara`. |
| `status` | string | One of: `DONE`, `PARTIAL`, `BLOCKED`. See status semantics below. |
| `commission_id` | string | ID of the commission this report responds to. Same as `id` for original commissions; may differ for amendment chains if Rook files a single report against multiple commission IDs. |
| `completed` | string | ISO 8601 timestamp when Rook finished writing the report (e.g. `"2026-04-06T15:45:00Z"`). |

### Frontmatter example

```yaml
---
id: "007"
title: "Add heartbeat to production watcher"
from: rook
to: mara
status: DONE
commission_id: "007"
completed: "2026-04-10T11:23:00Z"
---
```

---

## Status semantics

### `DONE`

All success criteria in the commission are met. The work is complete and verifiable.

### `PARTIAL`

Some tasks are done, some are not. Rook must explain:
- Which tasks succeeded (with verification notes)
- Which tasks were not completed and why
- Whether Mara needs to issue an amendment or if Rook can continue on the same commission

Use `PARTIAL` when Rook made meaningful progress but could not fully satisfy the success criteria.

### `BLOCKED`

Rook cannot proceed without input from Mara. The blocker must be explained clearly:
- What the blocker is
- What information or decision Mara must provide
- What Rook has done so far (if anything)

Use `BLOCKED` when a dependency outside Rook's decision rights is preventing progress. Do not start work and then discover a blocker silently — if a blocker is discovered mid-execution, report what was done before it was hit.

---

## Markdown body

The body sections are required. Order them as shown.

### `## What I did`

A concise summary of the actions taken. High-level narrative — what Rook did, in what order, and any significant decisions made during execution. This is the first thing Mara reads.

### `## What succeeded`

A list of outcomes that worked and can be verified. Reference specific files, commit hashes, or test results where applicable. Be concrete — "X is done" is less useful than "file `foo.md` created at `docs/contracts/`; committed as `abc1234`."

### `## What failed`

What didn't work. Include error messages, root causes (if known), and what Rook attempted before giving up. If nothing failed, write "Nothing."

### `## Blockers / Questions for Mara`

Anything that needs Mara's input before work can continue. If the report status is `BLOCKED`, the blocker must be described here in enough detail for Mara to act on it. If status is `DONE` or `PARTIAL` with no open questions, write "None."

### `## Files changed`

A list of files created, modified, or deleted during the commission. Include the full path from the project root and a one-line description of what changed.

**Format:**
```
- `path/to/file.md` — created: description
- `path/to/other.js` — modified: description
- `path/to/old.txt` — deleted
```

---

## Minimal example

```markdown
---
id: "003"
title: "Create .gitignore"
from: rook
to: mara
status: DONE
commission_id: "003"
completed: "2026-04-07T10:47:00Z"
---

## What I did

Created `.gitignore` at the project root with the four required patterns and committed it.

## What succeeded

- `.gitignore` created with `.DS_Store`, `node_modules/`, `*.log`, `.env` patterns.
- Verified with `git status` — no excluded artifacts appear as untracked.
- Committed as `a1b2c3d` on branch `slice/2-watcher`.

## What failed

Nothing.

## Blockers / Questions for Mara

None.

## Files changed

- `.gitignore` — created: excludes macOS and Node.js artifacts
```
