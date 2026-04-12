# Report Format — Liberation of Bajor

*Contract version: 1.0*
*Source: PRD — Liberation of Bajor v2.1, §5.3; Architecture v1.1*
*Author: Kira*
*Locked: 2026-04-06*

---

## Overview

A report is a markdown file with YAML frontmatter, written by O'Brien after executing a brief. O'Brien writes it to `{id}-DONE.md` in the queue directory before his process exits. Kira reads it to evaluate whether the brief is complete.

---

## DONE vs. ERROR distinction

This distinction is critical and must be understood by both Kira and O'Brien.

| File | Written by | Meaning |
|---|---|---|
| `{id}-DONE.md` | **O'Brien** | O'Brien executed the brief and produced a report. The report may say `DONE`, `PARTIAL`, or `BLOCKED` — but in all cases, Kira has something to evaluate. |
| `{id}-ERROR.md` | **The watcher** | The `claude -p` invocation itself failed — crash, timeout, non-zero exit with no report written by O'Brien. ERROR means infrastructure broke, not that O'Brien's work failed. |

**O'Brien always writes a DONE file.** Even if the brief cannot be completed (PARTIAL) or is stuck (BLOCKED), O'Brien writes a DONE file explaining the situation. O'Brien never writes an ERROR file — that is the watcher's sole responsibility.

---

## File naming

```
{id}-DONE.md
```

`{id}` matches the brief ID. **Examples:** `001-DONE.md`, `042-DONE.md`

---

## YAML frontmatter

### Required fields

| Field | Type | Description |
|---|---|---|
| `id` | string | Zero-padded three-digit ID matching the brief (e.g. `"003"`). Must be quoted. |
| `title` | string | Brief title, copied from the brief frontmatter. |
| `from` | string | Always `obrien`. |
| `to` | string | Always `kira`. |
| `status` | string | One of: `DONE`, `PARTIAL`, `BLOCKED`. See status semantics below. |
| `commission_id` | string | ID of the brief this report responds to. Same as `id` for original briefs; may differ for amendment chains if O'Brien files a single report against multiple brief IDs. |
| `completed` | string | ISO 8601 timestamp when O'Brien finished writing the report (e.g. `"2026-04-06T15:45:00Z"`). |

### Frontmatter example

```yaml
---
id: "007"
title: "Add heartbeat to production watcher"
from: obrien
to: kira
status: DONE
commission_id: "007"
completed: "2026-04-10T11:23:00Z"
---
```

---

## Status semantics

### `DONE`

All success criteria in the brief are met. The work is complete and verifiable.

### `PARTIAL`

Some tasks are done, some are not. O'Brien must explain:
- Which tasks succeeded (with verification notes)
- Which tasks were not completed and why
- Whether Kira needs to issue an amendment or if O'Brien can continue on the same brief

Use `PARTIAL` when O'Brien made meaningful progress but could not fully satisfy the success criteria.

### `BLOCKED`

O'Brien cannot proceed without input from Kira. The blocker must be explained clearly:
- What the blocker is
- What information or decision Kira must provide
- What O'Brien has done so far (if anything)

Use `BLOCKED` when a dependency outside O'Brien's decision rights is preventing progress. Do not start work and then discover a blocker silently — if a blocker is discovered mid-execution, report what was done before it was hit.

---

## Markdown body

The body sections are required. Order them as shown.

### `## What I did`

A concise summary of the actions taken. High-level narrative — what O'Brien did, in what order, and any significant decisions made during execution. This is the first thing Kira reads.

### `## What succeeded`

A list of outcomes that worked and can be verified. Reference specific files, commit hashes, or test results where applicable. Be concrete — "X is done" is less useful than "file `foo.md` created at `docs/contracts/`; committed as `abc1234`."

### `## What failed`

What didn't work. Include error messages, root causes (if known), and what O'Brien attempted before giving up. If nothing failed, write "Nothing."

### `## Blockers / Questions for Kira`

Anything that needs Kira's input before work can continue. If the report status is `BLOCKED`, the blocker must be described here in enough detail for Kira to act on it. If status is `DONE` or `PARTIAL` with no open questions, write "None."

### `## Files changed`

A list of files created, modified, or deleted during the brief. Include the full path from the project root and a one-line description of what changed.

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
from: obrien
to: kira
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

## Blockers / Questions for Kira

None.

## Files changed

- `.gitignore` — created: excludes macOS and Node.js artifacts
```
