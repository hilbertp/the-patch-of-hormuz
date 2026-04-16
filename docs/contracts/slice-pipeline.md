# Slice Pipeline — Technical Specification

*Derived from: [`slice-lifecycle.md`](./slice-lifecycle.md) (the BR / source of truth).*
*Describes: how the BR is implemented on disk, in `bridge/watcher.js`, and in the Ops Center server.*
*Scope rule: if this document disagrees with the BR, this document is wrong. Every section below exists to realise the BR — nothing more.*

---

## 0. Purpose

The BR defines **what** the pipeline must do — actors, states, transitions, invariants. This document defines **how** the current codebase realises those requirements. It covers:

- the on-disk filesystem layout and file-naming convention,
- the YAML frontmatter and markdown-body schema of the slice file,
- the mapping from BR states to on-disk filename suffixes,
- who performs each physical move (watcher vs. server vs. role) and with what primitive,
- the `bridge/register.jsonl` event log,
- the tooling each actor uses (`bridge/new-slice.js`, the watcher, the Ops Center approve endpoint).

Anywhere the implementation diverges from the BR, the divergence is flagged in §12 as a candidate for a follow-up slice.

---

## 1. Filesystem layout

Everything the pipeline needs lives under `bridge/` in the repo:

```
bridge/
  staged/          — slices awaiting Philipp's approval (STAGED)
  queue/           — approved slices moving through the pipeline (all post-STAGED states)
  trash/           — soft-deleted / superseded files (preserved for audit)
  templates/       — canonical slice.md and report.md templates
  scripts/         — helper scripts (one-off maintenance)
  logs/            — watcher + server runtime logs
  errors/          — error sidecars (BLOCKED and ERROR details)
  new-slice.js     — sole slice-creation tool (O'Brien)
  watcher.js       — orchestrator (the only process that moves slice files across directories and performs git ops)
  register.jsonl   — append-only event log (see §7)
  heartbeat.json   — liveness signal from the watcher
```

Worktrees live **outside** the repo, at `/private/tmp/ds9-worktrees/<branch>`. This keeps per-slice build artefacts off the FUSE mount and sidesteps the delete-blocked FUSE limitation documented in `docs/git-strategy.md`.

---

## 2. File-naming convention

One file per slice. The filename suffix **is** the state. The watcher enforces one-file-per-slice-at-a-time via atomic `fs.renameSync` between directories.

```
{id}-{STATE}.md
```

- `{id}` — zero-padded three-digit sequential string (e.g. `140`). Assigned by `new-slice.js` via `watcher.nextSliceId()`.
- `{STATE}` — one of the suffixes in the state-mapping table (§4).

Examples: `140-STAGED.md`, `140-IN_PROGRESS.md`, `140-DONE.md`, `140-ARCHIVED.md`.

There is never more than one live file for a given `{id}`. Prior rounds of review are kept as appended blocks *inside* the single file, not as sidecar files (see §8, append-only).

---

## 3. YAML frontmatter + markdown body

The slice file opens with a YAML frontmatter block, then the markdown body.

### 3.1 Frontmatter — required fields

| Field       | Type   | Description                                                                                |
|-------------|--------|--------------------------------------------------------------------------------------------|
| `id`        | string | Zero-padded three-digit ID, matches filename. Must be quoted.                              |
| `title`     | string | Short human title.                                                                         |
| `goal`      | string | One sentence describing the outcome. Rom reads this as the single source of scope.         |
| `from`      | string | Always `obrien` (O'Brien is the sole slice author).                                        |
| `to`        | string | `rom` or `leeta`. Defaults to `rom`.                                                       |
| `priority`  | string | One of: `normal`, `high`, `critical`. (Validated by `new-slice.js`.)                       |
| `created`   | string | ISO 8601 timestamp (UTC).                                                                  |
| `status`    | string | Current state name — kept in sync with the filename suffix.                                |

### 3.2 Frontmatter — optional fields

| Field         | Type              | Description                                                                                       |
|---------------|-------------------|---------------------------------------------------------------------------------------------------|
| `amendment`   | string or null    | Prior branch name this slice reworks (e.g. `"slice/139"`). Absent / null for originals.           |
| `depends_on`  | string or null    | Comma-separated IDs. Informational only — the watcher does not enforce dependency ordering.       |
| `timeout_min` | integer or null   | Per-slice inactivity timeout. `null` means the watcher default (20 min) applies.                  |

### 3.3 Markdown body — required sections

Authored by O'Brien (via `new-slice.js --body-file` or stdin). The sections are:

- `## Goal` — restates and expands the frontmatter `goal` line.
- `## Context` — prior state, links to relevant docs, constraints the reader needs.
- `## Scope` / `## Out of scope` — what this slice changes / does not change.
- `## Tasks` — numbered list of concrete steps for Rom.
- `## Acceptance criteria` — explicit, checkable conditions. Nog evaluates against these.
- `## Quality + goal check` — sanity notes for Rom and Nog.
- `## Files expected to change` — the expected diff surface.

A slice with no body is not valid. O'Brien never ships an empty `## Acceptance criteria`.

---

## 4. BR state → on-disk filename suffix

The BR has 8 business states. The filesystem uses 7 suffixes. The mapping is:

| # | BR state     | On-disk suffix      | Location                 | Notes                                           |
|---|--------------|---------------------|--------------------------|-------------------------------------------------|
| 1 | STAGED       | `-STAGED.md`        | `bridge/staged/`         | Awaiting Philipp's approval in the Ops Center.  |
| 2 | QUEUED       | `-QUEUED.md`        | `bridge/queue/`          | Legacy `-PENDING.md` dual-read for migration.   |
| 3 | IN_PROGRESS  | `-IN_PROGRESS.md`   | `bridge/queue/`          | Watcher has spawned Rom in a worktree.          |
| 4 | DONE         | `-DONE.md`          | `bridge/queue/`          | Rom's completion report appended.               |
| 5 | IN_REVIEW    | `-IN_REVIEW.md`     | `bridge/queue/`          | Legacy `-REVIEWED.md` dual-read for migration.  |
| 6 | ACCEPTED     | `-ACCEPTED.md`      | `bridge/queue/`          | Nog has appended a PASS verdict.                |
| 7 | MERGED       | (commit on `main`)  | n/a                      | Merge commit; file keeps `-ACCEPTED.md` until archive. |
| 8 | ARCHIVED     | `-ARCHIVED.md`      | `bridge/queue/`          | Terminal read-only state. Branch + worktree pruned. |

> **Note:** `-PARKED.md` is an internal intermediate suffix (not a BR state) used by the watcher to park the original slice body while Nog evaluates. It replaces the previous use of `-ARCHIVED.md` for this purpose (slice 145). Legacy slices may still use `-ARCHIVED.md` as the parked suffix.

---

## 5. Transition mechanics

Each transition is performed by exactly one actor. The primitive is either an atomic `fs.renameSync` (for state moves) or a single-writer file-append (for appending content into the slice file).

| From → To                              | Actor           | Primitive                                                                                   |
|----------------------------------------|-----------------|---------------------------------------------------------------------------------------------|
| — → STAGED                             | O'Brien         | `new-slice.js` writes `bridge/staged/{id}-STAGED.md`.                                       |
| STAGED → QUEUED                        | Ops Center server | On `POST /approve`, server writes `queue/{id}-QUEUED.md`. Emits `HUMAN_APPROVAL`. |
| QUEUED → IN_PROGRESS                   | Watcher         | Picks lowest-ID `-QUEUED.md` (or legacy `-PENDING.md`), `renameSync` → `-IN_PROGRESS.md`, creates worktree, spawns Rom. Emits `COMMISSIONED`. |
| IN_PROGRESS → DONE                     | Rom (via watcher) | Rom appends his report to the slice file; watcher `renameSync` → `-DONE.md`. Emits `DONE`. |
| DONE → IN_REVIEW                       | Watcher         | `renameSync` → `-IN_REVIEW.md`, spawns Nog.                                                 |
| IN_REVIEW → ACCEPTED                   | Nog (via watcher) | Nog appends PASS verdict; watcher `renameSync` → `-ACCEPTED.md`. Emits `NOG_PASS` + `ACCEPTED` + `REVIEW_RECEIVED`. |
| IN_REVIEW → QUEUED  *(reject, rework)* | Nog (via watcher) | Nog appends rejection block; watcher writes `-QUEUED.md`. Round counter + 1. Emits `REVIEWED` + `REVIEW_RECEIVED`. |
| IN_PROGRESS → STAGED  *(slice-broken fast path)* | Rom → O'Brien | Rom appends an **escalation block** (see §10). Watcher `renameSync` → `staged/{id}-STAGED.md`. Round counter **not** incremented (§9). |
| IN_REVIEW → STAGED  *(6th rejection)*  | Nog → O'Brien   | After a 6th Nog rejection, watcher `renameSync` → `staged/{id}-STAGED.md` for O'Brien rework. |
| ACCEPTED → MERGED                      | Watcher         | `git merge --no-ff slice/{id}` on `main`, then `git push origin main`. Emits `MERGED` (or `MERGE_FAILED` on guard trip). |
| MERGED → ARCHIVED                      | Watcher         | `renameSync` → `-ARCHIVED.md`, `git worktree prune`, `git branch -D`. Emits `ARCHIVED`.     |

---

## 6. Actor tooling

| Actor       | Tool                                   | Surface                                                                                  |
|-------------|----------------------------------------|------------------------------------------------------------------------------------------|
| O'Brien     | `bridge/new-slice.js`                  | Sole slice-creation path. Enforces required fields, assigns the ID, writes to `staged/`. |
| Philipp     | Ops Center (HTTP UI)                   | Approve / reject staged slices. Backed by the approve endpoint (logs `HUMAN_APPROVAL`).  |
| Watcher     | `bridge/watcher.js`                    | Single owner of directory moves + git ops. Polls on interval; one slice at a time.       |
| Rom         | `claude -p` (spawned by watcher)       | Writes code on the slice branch + appends a DONE report to the slice file.               |
| Nog         | `claude -p` (spawned by watcher)       | Reads the slice file + diff, appends a verdict (PASS / REJECT / ESCALATE-to-OBRIEN).     |

No actor other than the watcher performs `git checkout`, `git merge`, or cross-directory renames. This is the FUSE-safe discipline captured in `docs/git-strategy.md`.

---

## 7. `register.jsonl` — event log

`bridge/register.jsonl` is an append-only JSONL file. Every significant transition emits one line. Used by the Ops Center for live state and by humans for audit.

### 7.1 Canonical events

| `event`           | Emitter | Meaning                                                                              |
|-------------------|---------|--------------------------------------------------------------------------------------|
| `COMMISSIONED`    | Watcher | A PENDING slice was just promoted to IN_PROGRESS; Rom is spawning.                   |
| `HUMAN_APPROVAL`  | Server  | Philipp clicked Approve on a staged slice.                                           |
| `DONE`            | Watcher | Rom finished and wrote his report.                                                   |
| `REVIEWED`        | Watcher | Nog appended a verdict (PASS or REJECT) — low-level event.                           |
| `NOG_PASS`        | Watcher | Specifically a PASS verdict. Paired with `ACCEPTED`.                                 |
| `ACCEPTED`        | Watcher | State transition to ACCEPTED confirmed.                                              |
| `REVIEW_RECEIVED` | Watcher | Mirror of the verdict for dashboard consumption.                                     |
| `MERGED`          | Watcher | Merge commit succeeded and pushed.                                                   |
| `MERGE_FAILED`    | Watcher | Merge blocked — commonly by the truncation guard (§11).                              |
| `BLOCKED`         | Rom/Nog | Actor could not proceed; reason recorded in the corresponding `-DONE.md` / error file. |
| `ERROR`           | Watcher | Infrastructure failure (role spawn crash, git failure, etc.).                        |
| `API_RETRY`       | Watcher | Transient API hiccup retried transparently. Informational.                           |

### 7.2 Minimum schema

Every line has at least: `ts` (ISO 8601 UTC), `event`, `slice_id`. Most have additionally: `id` (legacy alias for slice_id), `branch`, `sha` (for MERGED), `reason` (for ACCEPTED / MERGE_FAILED / BLOCKED), `round` (for REVIEWED / NOG_PASS). Consumers must ignore fields they do not recognise.

---

## 8. Append-only discipline (physical enforcement)

BR invariant #5 — "the slice file is append-only after it leaves STAGED" — is realised as follows:

- **O'Brien** writes a fresh slice file **only** through `new-slice.js`. Any attempt to overwrite a file that already exists in `bridge/staged/` is blocked by the script.
- **Rom** never edits the slice file above his own appended report block. His implementation work happens on the `slice/{id}` git branch, not in the slice file.
- **Nog** reads the slice file + the branch diff, then appends a clearly-delimited verdict block (Markdown heading `## Nog Review — Round N`). He does not modify anything above that heading.
- **Watcher** renames files between directories but does not rewrite content. The suffix changes; the bytes above the last appended block are preserved.

A rejection loop therefore produces a file with the structure:

```
[O'Brien's original slice body]
---
[Rom's Round 1 DONE report]
---
## Nog Review — Round 1  (REJECT)
[findings]
---
[Rom's Round 2 DONE report]
---
## Nog Review — Round 2  (REJECT)
...
```

Each round is visible in a single `cat {id}-*.md`.

---

## 9. Rejection round counter

The counter lives on the slice file itself, not in memory or the register. The watcher determines the current round by counting `## Nog Review — Round N` headings in the file. The cap is 5; on the 6th reject, the watcher routes the slice back to `bridge/staged/` for O'Brien rework instead of back to `bridge/queue/{id}-QUEUED.md`.

The **Rom slice-broken fast path** (§10) is explicitly exempt — when Rom escalates, the round counter is not incremented and the 6-round cap does not apply.

---

## 10. Rom slice-broken fast path

Realises BR §Rejection-flow (b) and BR invariant #9.

At a rejection pickup, if Rom judges that the ACs or goal/purpose itself is wrong (not his implementation), he:

1. Appends a block with the Markdown heading `## Rom Escalation — Slice Broken` to the slice file.
2. Under that heading, writes, in prose:
   - which AC(s) or which element of the goal/purpose is wrong, cited verbatim;
   - why he judges it wrong;
   - what he believes O'Brien should reconsider.
3. Does **not** write any code on the branch during this pickup.
4. Emits his report with a special header indicating escalation. The watcher routes the slice to `bridge/staged/` for O'Brien instead of attempting another round with Nog.

The watcher recognises the escalation block by the exact heading `## Rom Escalation — Slice Broken`. Presence of this heading in Rom's DONE output short-circuits the normal DONE → IN_REVIEW transition and routes directly to STAGED.

O'Brien, on picking the slice back up in STAGED, reads the full history (original body + all prior rounds + Rom's escalation block) and either rewrites the slice (new ACs / new goal) or restages with a written counter-argument if he determines Rom misread the slice.

---

## 10.1. Rejection-round sidecar (`handleAmendment` / `handleNogReturn`)

When Nog rejects a slice with verdict `AMENDMENT_NEEDED` (or `RETURN`), the watcher performs two actions:

1. **Terminal sidecar rename.** The current round's evaluating file (`${id}-EVALUATING.md`) is renamed to `${id}-IN_REVIEW.md`. This file is a historical terminal artefact of that review round — it is no longer active in the pipeline and will not be picked up again. (Legacy files may still use the `-REVIEWED.md` suffix; both are accepted on read.)

2. **Amendment slice spawn.** A new amendment slice is written at `${nextId}-QUEUED.md` (per slice 146's naming), containing the failed criteria, amendment instructions, and the original acceptance criteria. This new slice re-enters the pipeline at state 2 (QUEUED) and is picked up by the watcher in the normal poll loop.

**BR-invariant divergence.** This pattern splits the slice across two IDs: the original `${id}` (now terminated at `-IN_REVIEW.md`) and the amendment `${nextId}` (a fresh QUEUED file). BR invariant #1 ("one file per slice") expects a single file to track the full lifecycle. The current implementation instead creates a sidecar chain: `id → nextId → nextNextId`, linked by the `root_commission_id` frontmatter field.

A future slice will converge this to the append-only pattern described in §8, where Nog's rejection is appended to the original slice file and the same ID re-enters the queue — eliminating the sidecar chain. Until then, the `root_commission_id` field and the `countReviewedCycles()` function (which counts `REVIEWED` register events across IDs sharing a root) provide the cross-ID linkage.

---

## 11. Pre-merge safety (retired)

*Retired in slice 144.*

The watcher formerly ran a "truncation guard" before every merge: it diffed each file touched by the slice against `main` and blocked the merge if any file with >50 lines lost more than 50% of its content, emitting `MERGE_FAILED` with `reason: "truncation_guard"`.

**Original design intent.** The guard targeted three hypothesised failure modes: (1) FUSE partial-writes at checkout, (2) stale-base overwrites when agents forked from an outdated `main`, and (3) LLM context compaction silently truncating files mid-edit.

**Why each mode is no longer a concern.**
- *FUSE partial-write* — eliminated by the worktree migration. Slice builds run on local-FS worktrees at `/private/tmp/ds9-worktrees/`, not on the FUSE mount.
- *Stale-base overwrite* — eliminated by watcher-owned branching. No agent creates or switches branches; the watcher is the sole owner of all git operations.
- *LLM context compaction* — never observed. `compaction_occurred` has been tracked since slice 054; all values across ~140 slices are `false` or `null`. Rom's Write/Edit tool calls are atomic from the guard's perspective.

**Observed firings — both false positives.**
- Slice 138 (2026-04-16T17:51:49Z): blocked an intentional deletion of `docs/contracts/queue-lifecycle.md` (127 → 6 lines).
- Slice 142 (2026-04-16T20:33:25Z): blocked an intentional deletion of `docs/contracts/brief-format.md` (146 → 0 lines).

Both firings forced an additive-stub workaround instead of a clean deletion. The guard was pure overhead blocking legitimate refactors.

**Remaining semantic check.** Nog reviews the full file diff before any merge is accepted. This is the appropriate layer for catching unintended deletions — a human-readable review, not a mechanical line-count heuristic.

---

## 12. Known divergences from the BR

The BR explicitly says these are flagged for triage and **not** part of the requirements:

1. **~~State-name divergence: QUEUED vs. `-PENDING.md`.~~** Resolved in slice 146. On-disk suffix is now `-QUEUED.md`. All write sites produce `-QUEUED.md` with `status: QUEUED`. Read sites dual-accept both `-QUEUED.md` and legacy `-PENDING.md` for in-flight migration.
2. **~~State-name divergence: IN_REVIEW vs. `-REVIEWED.md`.~~** Resolved in slice 147. On-disk suffix is now `-IN_REVIEW.md`. All write sites produce `-IN_REVIEW.md`. Legacy `-REVIEWED.md` files are dual-read for migration.
3. **`ARCHIVED` name collision** (BR §Known code divergences). `bridge/watcher.js` around line 1826 reused `-ARCHIVED.md` as a "parked-during-review" suffix before Nog evaluates, colliding with the terminal ARCHIVED state. **Fixed in slice 145** — parked suffix renamed to `-PARKED.md`. Legacy slices retain `-ARCHIVED.md` as the parked suffix with fallback reads in both the watcher and dashboard server.
4. **~~Undocumented `-REVIEWED.md` sidecar~~** (BR §Known code divergences). Documented in slice 147 — see §10.1 "Rejection-round sidecar." The sidecar (now `-IN_REVIEW.md`) is the terminal artefact of a rejected review round. Full converge to append-only pattern deferred to a future slice.

These are candidates for their own slices. None are blocking.

---

## 13. Change control

- The BR (`slice-lifecycle.md`) is the source of truth. This document must match it.
- When the BR changes, this document is updated in the same slice or the immediately-following slice.
- When the **implementation** legitimately evolves (new suffix, new event, refactored watcher path), this document is updated. The BR is *not* updated unless the change affects the business flow.
- Divergences between this document and the codebase should be filed as slices, not patched in prose.
