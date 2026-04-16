# Slice Format — Liberation of Bajor

*Contract version: 2.0*
*Source of truth: [`slice-lifecycle.md`](./slice-lifecycle.md) (BR), [`slice-pipeline.md`](./slice-pipeline.md) (technical spec).*
*Author: O'Brien.*
*Supersedes: `brief-format.md` (v1.0, 2026-04-06).*

---

## Overview

A slice is a markdown file with YAML frontmatter, authored by O'Brien through `bridge/new-slice.js` and consumed by Rom (or Leeta). The frontmatter carries structured metadata the watcher uses to manage the lifecycle; the markdown body contains everything the implementor needs to execute the slice independently.

**O'Brien never writes frontmatter by hand.** All slices must be created via `bridge/new-slice.js`, which validates required fields, assigns the ID, and places the file in `bridge/staged/`.

**The watcher injects nothing into the implementor's context.** Every slice must be self-contained, or explicitly reference files the implementor can look up in the project filesystem.

---

## File naming

```
{id}-STAGED.md
```

- `{id}` — zero-padded three-digit sequential string (e.g. `142`). Assigned by `bridge/new-slice.js` via `watcher.nextSliceId()`.
- `STAGED` — the initial state. Subsequent state suffixes (`-PENDING.md`, `-IN_PROGRESS.md`, `-DONE.md`, `-REVIEWED.md`, `-ACCEPTED.md`, `-ARCHIVED.md`) are set by the watcher as the slice progresses. See `slice-pipeline.md` §4 for the full state-to-suffix mapping.

---

## YAML frontmatter

The frontmatter block opens and closes with `---`. All keys are lowercase. Values are strings unless noted.

### Required fields

| Field       | Type   | Description                                                                                |
|-------------|--------|--------------------------------------------------------------------------------------------|
| `id`        | string | Zero-padded three-digit ID matching the filename (e.g. `"142"`). Must be quoted.           |
| `title`     | string | Short human title.                                                                         |
| `goal`      | string | One sentence describing the outcome. This is the implementor's single source of scope.     |
| `from`      | string | Always `obrien`.                                                                           |
| `to`        | string | `rom` or `leeta`. Default is `rom`.                                                        |
| `priority`  | string | One of: `normal`, `high`, `critical`. Enforced by `new-slice.js`.                          |
| `created`   | string | ISO 8601 timestamp (UTC). Written automatically by `new-slice.js`.                         |
| `status`    | string | Current state name. Initialised to `STAGED`; kept in sync with the filename suffix.        |

### Optional fields

| Field         | Type              | Description                                                                                       |
|---------------|-------------------|---------------------------------------------------------------------------------------------------|
| `amendment`   | string or null    | Prior branch name this slice reworks (e.g. `"slice/139"`). Absent / null for originals.           |
| `depends_on`  | string or null    | Comma-separated IDs. Informational only — the watcher does not enforce dependency ordering.       |
| `timeout_min` | integer or null   | Per-slice inactivity timeout. `null` means the watcher default (20 min) applies.                  |

### Frontmatter example

```yaml
---
id: "142"
title: "docs/contracts: replace brief-format with slice-format"
goal: "Install the current slice file format in the contracts directory."
from: obrien
to: rom
priority: normal
created: "2026-04-16T20:00:00Z"
amendment: null
timeout_min: null
status: STAGED
---
```

---

## Markdown body

The body is freeform prose read by the implementor. The following sections are required. Order them as shown.

### `## Goal`

Restates and expands the frontmatter `goal` line. What the slice achieves, in one or two sentences.

### `## Context`

Background the implementor needs. May reference:
- Project files by path (readable by the implementor).
- Prior slices by ID (the queue directory is readable).
- Decisions made by O'Brien, Sisko, Dax, or Philipp.
- Current system state relevant to the change.

Keep this section dense and factual. The implementor has access to the full project filesystem and git history, so do not repeat information already in `CLAUDE.md` or other permanent project files.

### `## Scope`

What this slice changes. Explicit directories, files, or functions. If the slice creates new files, list them.

### `## Out of scope`

What this slice does **not** change. Call out tempting adjacent work and explain why it belongs in a separate slice.

### `## Tasks`

A numbered list of concrete, verifiable steps. Each step should be specific enough that the implementor can mark it done or not done unambiguously. Include sub-tasks where helpful.

### `## Acceptance criteria`

How Nog will evaluate the slice. Write these as explicit, checkable conditions — `grep`s, `git diff --stat` expectations, presence/absence of particular text, test outcomes. The implementor evaluates his own work against these criteria before writing the DONE report.

### `## Quality + goal check`

Sanity notes for the implementor and reviewer. The *goal check* describes what a reader should see/experience on main after the slice lands. The *quality check* calls out constraints (byte-for-byte, no reformatting, no scope creep).

### `## Files expected to change`

A short bulleted list of the expected diff surface — one bullet per file, with `(added)`, `(modified)`, `(deleted)` annotations. Nog compares this list against `git diff --stat`.

---

## Self-containment requirement

The watcher pipes the slice content to the implementor and nothing else. No system preamble, no role description, no project history. The implementor is not stateless (he has `CLAUDE.md`, git history, and the filesystem), but O'Brien must not rely on him inferring context that isn't in the slice or reachable from the filesystem.

If a slice requires context from a document, either include it inline or explicitly reference the file path. If a slice requires context from a prior decision, state the decision in the `## Context` section.

When a slice carries payload content that must be copied verbatim (e.g. replacing a contract file), embed the content inline between explicit `=== BEGIN <path> ===` / `=== END <path> ===` markers. Do not rely on paths outside the worktree — the implementor cannot reach them.

---

## Minimal example

```markdown
---
id: "150"
title: "Add .gitignore"
goal: "Exclude macOS and Node.js artefacts from the repo."
from: obrien
to: rom
priority: normal
created: "2026-04-17T10:00:00Z"
amendment: null
timeout_min: null
status: STAGED
---

## Goal
Add a `.gitignore` at the project root that excludes common macOS and Node.js artefacts.

## Context
The repo root currently has no `.gitignore`. `.DS_Store` and `node_modules/` are accumulating.

## Scope
- Create `.gitignore` at the project root.

## Out of scope
- Ignore rules for editor configs or build artefacts — separate slice.

## Tasks
1. Create `.gitignore` at the project root.
2. Include: `.DS_Store`, `node_modules/`, `*.log`, `.env`.
3. Commit with message `chore: add .gitignore`.

## Acceptance criteria
1. `.gitignore` exists at the project root.
2. It contains `.DS_Store`, `node_modules/`, `*.log`, `.env`.
3. `git diff --stat main` shows exactly 1 file changed: `.gitignore` (added).

## Quality + goal check
- Goal check: checking out main and running `cat .gitignore` shows the four expected entries.
- Quality check: no other files touched.

## Files expected to change
- `.gitignore` (added)
```
