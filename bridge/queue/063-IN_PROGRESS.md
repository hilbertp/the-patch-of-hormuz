---
id: "063"
title: "Rename: Commission → Brief throughout the repo"
goal: "Every user-facing label, file, variable, and document uses 'Brief' instead of 'Commission'. The queue file suffix changes from COMMISSION to BRIEF. Nothing breaks."
from: kira
to: obrien
priority: normal
created: "2026-04-12T00:00:00Z"
references: null
timeout_min: 30
branch: "rename/63-commission-to-brief"
status: "PENDING"
---

## Why

"Commission" is being replaced with "Brief" as the standard term for a unit of work in this system. Brief is established military/tech terminology, carries no size connotation, and fits both the DS9 theme and the actual artifact (a scoped instruction document). This is a pure rename — no behaviour changes.

## Commit strategy

This is large. Commit in stages — do not batch everything into one commit. Suggested order: queue files → code → templates → docs → role files. Commit after each group.

---

## Task 1 — Queue files: rename COMMISSION suffix to BRIEF

In `bridge/queue/`, rename every file matching `*-COMMISSION.md` to `*-BRIEF.md`. There are ~43 of them.

```bash
cd bridge/queue
for f in *-COMMISSION.md; do git mv "$f" "${f/-COMMISSION.md/-BRIEF.md}"; done
```

Commit:
```
git commit -m "rename(queue): COMMISSION → BRIEF suffix on all queue files (commission 063)"
```

---

## Task 2 — watcher.js

In `bridge/watcher.js`, rename all references. This includes variable names, string literals, log messages, comments, and file path patterns. Key substitutions:

| Old | New |
|---|---|
| `COMMISSION` (state suffix) | `BRIEF` |
| `commission` (variable/function names) | `brief` |
| `Commission` (display text) | `Brief` |
| `-COMMISSION.md` (file glob patterns) | `-BRIEF.md` |
| `commission_id` in log/register payloads | `brief_id` |
| `current_commission` in heartbeat writes | `current_brief` |
| `commission_elapsed_seconds` in heartbeat | `brief_elapsed_seconds` |

**Be precise.** Do not rename `commission_id` in `timesheet.jsonl` schema (that's a data field, not a display term — leave it for a separate migration). Do rename the heartbeat JSON fields since the dashboard reads them.

Commit:
```
git commit -m "rename(watcher): Commission → Brief throughout watcher.js (commission 063)"
```

---

## Task 3 — dashboard/server.js

Same substitutions as Task 2. Pay attention to:
- API route paths: `/api/bridge/staged/:id/commission` → `/api/bridge/staged/:id/brief`
- Any string literals used in responses or log messages
- heartbeat field names read from heartbeat.json (`current_commission` → `current_brief`, `commission_elapsed_seconds` → `brief_elapsed_seconds`)

Commit:
```
git commit -m "rename(server): Commission → Brief throughout dashboard/server.js (commission 063)"
```

---

## Task 4 — dashboard/lcars-dashboard.html

- All display text: "Commission 057" → "Brief 057"
- JS variable names that reference commission: rename for consistency
- Heartbeat field reads: `commission_elapsed_seconds` → `brief_elapsed_seconds`, `current_commission` → `current_brief`
- Any API calls to `/api/bridge/staged/:id/commission` → `/api/bridge/staged/:id/brief`

Commit:
```
git commit -m "rename(dashboard): Commission → Brief in lcars-dashboard.html (commission 063)"
```

---

## Task 5 — Templates

- Rename `bridge/templates/commission.md` → `bridge/templates/brief.md`
- Update any internal content in that file that says "commission" → "brief"
- Update `bridge/templates/report.md` references to "commission" → "brief"

Commit:
```
git commit -m "rename(templates): commission.md → brief.md, update content (commission 063)"
```

---

## Task 6 — Contracts and kira docs

Rename files and update content:
- `docs/contracts/commission-format.md` → `docs/contracts/brief-format.md`
- `docs/kira/commission-watcher-task.md` → `docs/kira/brief-watcher-task.md`
- Update all content in `docs/contracts/queue-lifecycle.md` — replace "commission" → "brief", "COMMISSION" → "BRIEF"
- Update `docs/kira/amendment-examples.md` and `docs/kira/evaluation-rubric.md`

Commit:
```
git commit -m "rename(docs): commission → brief in contracts and kira docs (commission 063)"
```

---

## Task 7 — Active role and project docs

Update "commission" → "brief" (case-sensitive) in these live docs:
- `KIRA.md`
- `README.md`
- `.claude/CLAUDE.md`
- `.claude/TEAM-STANDARDS.md`
- `.claude/skills/estimate-hours/SKILL.md`
- `.claude/skills/handoff-to-teammate/SKILL.md`
- `.claude/roles/kira/ROLE.md`
- `.claude/roles/kira/LEARNING.md`
- `.claude/roles/obrien/ROLE.md`
- `.claude/roles/dax/ROLE.md`
- `.claude/roles/dax/LEARNING.md`
- `.claude/roles/sisko/ROLE.md`
- `.claude/roles/ziyal/ROLE.md`
- `.claude/roles/leeta/ROLE.md`

Do NOT update:
- Any `HANDOFF-*.md` or `RESPONSE-*.md` files — these are historical records
- Architecture docs in `docs/architecture/` — reference docs, leave as-is
- `DEBRIEF.md`, `MARA.md`, `bridge/dev-retrospective.md` — historical

Commit:
```
git commit -m "rename(roles): commission → brief in active role and project docs (commission 063)"
```

---

## Task 8 — bridge/next-id.js and bridge/slicelog.js

Check both files for any "commission" references and update to "brief".

---

## Constraints

- Branch: `rename/63-commission-to-brief`
- Do not rename `commission_id` in `bridge/timesheet.jsonl` schema or data — leave that field name alone
- Do not update HANDOFF, RESPONSE, or architecture docs
- Do not rename the `commission_id` field in the DONE report frontmatter template — O'Brien uses this field name and changing it requires a separate migration
- Commit after each task group — do not batch all changes into one commit

## Success criteria

1. `bridge/queue/` contains no files ending in `-COMMISSION.md`
2. `bridge/templates/brief.md` exists; `bridge/templates/commission.md` does not
3. `docs/contracts/brief-format.md` exists
4. Watcher heartbeat JSON writes `current_brief` and `brief_elapsed_seconds`
5. Dashboard displays "Brief 057" not "Commission 057"
6. API route `/api/bridge/staged/:id/brief` exists
7. `KIRA.md` and all active ROLE.md files use "brief" not "commission"
8. Watcher starts and processes a queue item without errors
9. DONE report includes all 5 metrics fields with real non-null values
