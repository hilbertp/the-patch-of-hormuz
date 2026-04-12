# Brief Format — Liberation of Bajor

*Contract version: 1.0*
*Source: PRD — Liberation of Bajor v2.1, §5.2; Architecture v1.1*
*Author: Kira*
*Locked: 2026-04-06*

---

## Overview

A brief is a markdown file with YAML frontmatter, written by Kira and dropped into the queue directory. The frontmatter carries structured metadata that the watcher uses to manage the lifecycle. The markdown body contains everything O'Brien needs to execute the brief independently.

**The watcher injects nothing into O'Brien's context.** Every brief must be self-contained, or explicitly reference files O'Brien can look up in the project filesystem.

---

## File naming

```
{id}-PENDING.md
```

`{id}` is a zero-padded sequential three-digit string (e.g. `001`, `002`, `003`). Kira assigns IDs. See `docs/contracts/queue-lifecycle.md` for ID assignment rules.

**Examples:** `001-PENDING.md`, `042-PENDING.md`

---

## YAML frontmatter

The frontmatter block opens and closes with `---`. All keys are lowercase. Values are strings unless noted.

### Required fields

| Field | Type | Description |
|---|---|---|
| `id` | string | Zero-padded three-digit ID matching the filename (e.g. `"003"`). Must be quoted. |
| `title` | string | Short human-readable title for the brief. |
| `from` | string | Always `kira`. |
| `to` | string | Always `obrien`. |
| `priority` | string | One of: `low`, `normal`, `high`, `spike`. |
| `created` | string | ISO 8601 timestamp when the brief was written (e.g. `"2026-04-06T14:30:00Z"`). |

### Optional fields

| Field | Type | Description |
|---|---|---|
| `references` | string or null | Direct parent brief ID as a quoted string (e.g. `"003"`), or `null` for original briefs. Used for amendment chains. The watcher ignores this field completely — it is Kira's record-keeping only. O'Brien can reconstruct a full amendment chain by reading the queue directory. |
| `timeout_min` | integer or null | Per-brief timeout override in minutes. `null` means the watcher's global default (15 minutes) applies. Use sparingly — briefs should be scoped to fit within the default. |

### Frontmatter example

```yaml
---
id: "007"
title: "Add heartbeat to production watcher"
from: kira
to: obrien
priority: normal
created: "2026-04-10T09:00:00Z"
references: null
timeout_min: null
---
```

---

## Markdown body

The body is freeform prose that O'Brien reads. The following sections are required. Order them as shown.

### `## Objective`

What O'Brien should accomplish, in one or two sentences. This is the single source of truth for scope — if O'Brien finishes the objective, the brief is done.

### `## Context`

Background information O'Brien needs. May reference:
- Project files by path (O'Brien can read them)
- Prior briefs by ID (O'Brien can read the queue directory)
- Decisions made by Kira, Soren, or Philipp
- Current system state relevant to the task

Keep this section dense and factual. O'Brien is not stateless — he has access to the full project filesystem and git history, so you do not need to repeat information that is already in `CLAUDE.md` or other permanent project files.

### `## Tasks`

A numbered list of concrete, verifiable things to do. Each task should be specific enough that O'Brien can mark it done or not done unambiguously. Include sub-tasks where helpful.

### `## Constraints`

Any explicit limits on scope, approach, or files to avoid. If there are no constraints, include the section with "None." — do not omit it.

### `## Success criteria`

How Kira will evaluate the brief. Write these as explicit, checkable conditions. O'Brien evaluates his own work against these criteria before writing his report.

---

## Self-containment requirement

The watcher pipes the brief content to O'Brien and nothing else. No system preamble, no role description, no project history. O'Brien is not stateless (he has `CLAUDE.md`, git history, and the filesystem), but Kira must not rely on O'Brien inferring context that isn't in the brief or reachable from the filesystem.

If a brief requires context from a document, either include it inline or explicitly reference the file path. If a brief requires context from a prior decision, state the decision in the Context section — do not assume O'Brien remembers prior conversations.

---

## Minimal example

```markdown
---
id: "003"
title: "Create .gitignore"
from: kira
to: obrien
priority: low
created: "2026-04-07T10:00:00Z"
references: null
timeout_min: null
---

## Objective

Create a `.gitignore` file at the project root that excludes common macOS and Node.js artifacts.

## Context

The project root currently has no `.gitignore`. Common artifacts like `.DS_Store` and `node_modules/` are accumulating.

## Tasks

1. Create `.gitignore` at the project root.
2. Include: `.DS_Store`, `node_modules/`, `*.log`, `.env`.
3. Commit to the current branch with message `chore: add .gitignore`.

## Constraints

- Do not touch any other files.

## Success criteria

1. `.gitignore` exists at the project root.
2. It suppresses `.DS_Store`, `node_modules/`, `*.log`, `.env`.
3. File is committed.
```
