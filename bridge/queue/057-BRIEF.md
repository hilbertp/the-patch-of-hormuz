---
id: "057"
title: "Consolidate timesheet.jsonl and slicelog.jsonl into one unified T&T log"
goal: "Every role — human and watcher — writes T&T entries to a single file, bridge/timesheet.jsonl, with a unified schema. slicelog.jsonl is retired."
from: kira
to: obrien
priority: high
created: "2026-04-12T00:00:00Z"
references: "056"
timeout_min: null
---

## Objective

Merge `bridge/slicelog.jsonl` (O'Brien's watcher-driven log) into `bridge/timesheet.jsonl` (human-role log) under a single unified schema. Retire `slicelog.jsonl`. Update all code and docs that reference either file to point to `timesheet.jsonl` only.

This is a consolidation commission. No new behaviour — just one source of truth for all T&T tracking.

---

## Context

Two files currently exist for the same purpose:

- `bridge/timesheet.jsonl` — human roles (Kira, Dax, Sisko, Ziyal, etc.) append entries manually via the `estimate-hours` skill
- `bridge/slicelog.jsonl` — the watcher appends/updates entries automatically for every O'Brien commission

The split was a historical accident. Sisko wants one file.

---

## Tasks

### 1. Define the unified schema

The unified schema is a superset of both files. Every row has these fields (null where not applicable):

**Core — all entries:**
- `ts` — ISO 8601 timestamp of entry creation
- `role` — who did the work (`"kira"`, `"dax"`, `"obrien"`, etc.)
- `source` — `"watcher"` (written by watcher.js) or `"manual"` (written by a human role)
- `commission_id` — string ID of the related commission, or null
- `title` — short description of work done (unifies `task` from timesheet and `title` from slicelog)
- `phase` — work phase (e.g. `"planning"`, `"execution"`, `"review"`) — null for watcher entries
- `human_hours` — estimated human-equivalent hours
- `human_role` — e.g. `"Delivery Coordinator"`, `"Senior Architect"` — null for watcher entries
- `actual_minutes` — real wall-clock minutes spent — null for watcher entries
- `notes` — freeform context string

**Optional — present on some human entries:**
- `deliverable` — named artifact, if applicable
- `slice` — slice number, if applicable

**Watcher-only — null for human entries:**
- `tokens_in`, `tokens_out`, `cost_usd`
- `elapsed_ms`
- `compaction_occurred`
- `runtime` — `"legacy"` or `"ruflo"`
- `expected_human_hours`
- `result` — `null` at DONE time, updated at terminal state
- `cycle`
- `ts_pickup`, `ts_done`, `ts_result`

### 2. Migrate existing data

**From `bridge/slicelog.jsonl`:** For each row, add `role: "obrien"`, `source: "watcher"`, rename `id` → `commission_id`, rename `estimated_human_hours` → `human_hours`. Null-fill all human-only fields. Append to `timesheet.jsonl`.

**From `bridge/timesheet.jsonl`:** For each existing row, add `source: "manual"`. Rename `task` → `title`. Null-fill all watcher-only fields. Write back in place (these are already in the file — just normalise them).

Preserve chronological order in the final file (sort by `ts`).

### 3. Update watcher.js and slicelog.js

- In `bridge/slicelog.js`: change the target file from `bridge/slicelog.jsonl` to `bridge/timesheet.jsonl`. Rename exported functions if helpful (`appendSliceLog` → `appendTimesheet`, `updateSliceLog` → `updateTimesheet`) — or keep the names and just change the path. Your call.
- Verify both write points in `watcher.js` still work correctly after the path change.
- Verify the metrics gate in the DONE handler is unaffected.

### 4. Update docs and skill files

Update all references from `slicelog.jsonl` → `timesheet.jsonl` and from `slicelog.js` → updated module name (if renamed) in:

- `.claude/skills/estimate-hours/SKILL.md`
- `.claude/skills/handoff-to-teammate/SKILL.md`
- `.claude/TEAM-STANDARDS.md`
- `.claude/roles/kira/ROLE.md`
- `.claude/roles/dax/ROLE.md`
- `docs/architecture/BET3-PER-SLICE-TRACKING.md`

Do not update historical HANDOFF files in `.claude/roles/*/` — those are records, not live docs.

### 5. Retire slicelog.jsonl

After migration and verification: delete `bridge/slicelog.jsonl`. Do not archive — it's fully absorbed into `timesheet.jsonl`.

### 6. README update

If `bridge/slicelog.jsonl` appears in the project structure section of `README.md`, remove it. If `bridge/timesheet.jsonl` is not listed, add it with description: "append-only T&T log for all roles (human and watcher)".

---

## Constraints

- Stay on a new branch: `slice/57-unified-timesheet`
- Do not change the watcher's functional behaviour — only file paths and field names
- Do not touch queue files, register.jsonl, or anchors.jsonl
- Do not modify any HANDOFF files in `.claude/roles/*/` (historical records)
- The migration must be lossless — every existing row in both files must appear in the result

---

## Success criteria

1. `bridge/timesheet.jsonl` contains all rows from both former files, with unified schema
2. `bridge/slicelog.jsonl` no longer exists
3. Watcher writes O'Brien's commission entries to `timesheet.jsonl` (verified by path in slicelog.js or watcher.js)
4. `estimate-hours/SKILL.md` references `timesheet.jsonl` only
5. `handoff-to-teammate/SKILL.md` references `timesheet.jsonl` only
6. `TEAM-STANDARDS.md` references `timesheet.jsonl` only
7. `kira/ROLE.md` and `dax/ROLE.md` reference `timesheet.jsonl` only
8. No regression in watcher behaviour (metrics gate, write points 1 and 2 still fire)
9. DONE report includes all 5 metrics fields with real non-null values
