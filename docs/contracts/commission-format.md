# Commission Format — Bridge of Hormuz

*Contract version: 1.0*
*Source: PRD — Bridge of Hormuz v2.1, §5.2; Architecture v1.1*
*Author: Mara*
*Locked: 2026-04-06*

---

## Overview

A commission is a markdown file with YAML frontmatter, written by Mara and dropped into the queue directory. The frontmatter carries structured metadata that the watcher uses to manage the lifecycle. The markdown body contains everything Rook needs to execute the commission independently.

**The watcher injects nothing into Rook's context.** Every commission must be self-contained, or explicitly reference files Rook can look up in the project filesystem.

---

## File naming

```
{id}-PENDING.md
```

`{id}` is a zero-padded sequential three-digit string (e.g. `001`, `002`, `003`). Mara assigns IDs. See `docs/contracts/queue-lifecycle.md` for ID assignment rules.

**Examples:** `001-PENDING.md`, `042-PENDING.md`

---

## YAML frontmatter

The frontmatter block opens and closes with `---`. All keys are lowercase. Values are strings unless noted.

### Required fields

| Field | Type | Description |
|---|---|---|
| `id` | string | Zero-padded three-digit ID matching the filename (e.g. `"003"`). Must be quoted. |
| `title` | string | Short human-readable title for the commission. |
| `from` | string | Always `mara`. |
| `to` | string | Always `rook`. |
| `priority` | string | One of: `low`, `normal`, `high`, `spike`. |
| `created` | string | ISO 8601 timestamp when the commission was written (e.g. `"2026-04-06T14:30:00Z"`). |

### Optional fields

| Field | Type | Description |
|---|---|---|
| `references` | string or null | Direct parent commission ID as a quoted string (e.g. `"003"`), or `null` for original commissions. Used for amendment chains. The watcher ignores this field completely — it is Mara's record-keeping only. Rook can reconstruct a full amendment chain by reading the queue directory. |
| `timeout_min` | integer or null | Per-commission timeout override in minutes. `null` means the watcher's global default (15 minutes) applies. Use sparingly — commissions should be scoped to fit within the default. |

### Frontmatter example

```yaml
---
id: "007"
title: "Add heartbeat to production watcher"
from: mara
to: rook
priority: normal
created: "2026-04-10T09:00:00Z"
references: null
timeout_min: null
---
```

---

## Markdown body

The body is freeform prose that Rook reads. The following sections are required. Order them as shown.

### `## Objective`

What Rook should accomplish, in one or two sentences. This is the single source of truth for scope — if Rook finishes the objective, the commission is done.

### `## Context`

Background information Rook needs. May reference:
- Project files by path (Rook can read them)
- Prior commissions by ID (Rook can read the queue directory)
- Decisions made by Mara, Soren, or Philipp
- Current system state relevant to the task

Keep this section dense and factual. Rook is not stateless — he has access to the full project filesystem and git history, so you do not need to repeat information that is already in `CLAUDE.md` or other permanent project files.

### `## Tasks`

A numbered list of concrete, verifiable things to do. Each task should be specific enough that Rook can mark it done or not done unambiguously. Include sub-tasks where helpful.

### `## Constraints`

Any explicit limits on scope, approach, or files to avoid. If there are no constraints, include the section with "None." — do not omit it.

### `## Success criteria`

How Mara will evaluate the commission. Write these as explicit, checkable conditions. Rook evaluates his own work against these criteria before writing his report.

---

## Self-containment requirement

The watcher pipes the commission content to Rook and nothing else. No system preamble, no role description, no project history. Rook is not stateless (he has `CLAUDE.md`, git history, and the filesystem), but Mara must not rely on Rook inferring context that isn't in the commission or reachable from the filesystem.

If a commission requires context from a document, either include it inline or explicitly reference the file path. If a commission requires context from a prior decision, state the decision in the Context section — do not assume Rook remembers prior conversations.

---

## Minimal example

```markdown
---
id: "003"
title: "Create .gitignore"
from: mara
to: rook
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
