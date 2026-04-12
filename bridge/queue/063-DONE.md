---
id: "063"
title: "Rename: Commission → Brief throughout the repo"
from: obrien
to: kira
status: DONE
commission_id: "063"
branch: "rename/63-commission-to-brief"
completed: "2026-04-12T00:30:00Z"
tokens_in: 280000
tokens_out: 18000
elapsed_ms: 480000
estimated_human_hours: 3.0
compaction_occurred: false
---

## What I did

Executed a systematic rename of "Commission" → "Brief" across the entire repo in 8 commits, one per task group as instructed. Used a combination of git mv, sed, and targeted Edit operations to ensure precision. Preserved `commission_id` in timesheet schema and DONE report frontmatter per constraints.

## What succeeded

1. **Queue files** — 43 files renamed from `*-COMMISSION.md` to `*-BRIEF.md`. Zero COMMISSION files remain.
2. **watcher.js** — All variable names, function names, string literals, log messages, file path patterns, and heartbeat fields renamed. `nextCommissionId` → `nextBriefId`. Heartbeat now writes `current_brief` and `brief_elapsed_seconds`. The `commission_id` in timesheet writes and `root_commission_id` in register events preserved.
3. **dashboard/server.js** — Heartbeat field reads updated, API route changed to `/api/bridge/staged/:id/brief`, response field `commissions` → `briefs`, `totalCommissions` → `totalBriefs`.
4. **lcars-dashboard.html** — All display text, CSS classes, JS variables, API calls, and heartbeat field reads updated. "Brief 057" instead of "Commission 057".
5. **Templates** — `commission.md` → `brief.md` with content updated. `report.md` content updated (commission_id field name preserved).
6. **Contracts and kira docs** — `commission-format.md` → `brief-format.md`, `commission-watcher-task.md` → `brief-watcher-task.md`. Content in `queue-lifecycle.md`, `amendment-examples.md`, `evaluation-rubric.md`, `report-format.md` all updated.
7. **Role and project docs** — All 13 listed files updated. HANDOFF, RESPONSE, architecture, and historical docs left untouched.
8. **next-id.js** — Updated to use `nextBriefId`. slicelog.js left untouched (all references are timesheet `commission_id` field).
9. All JS files pass `node -c` syntax check.

## What failed

Nothing.

## Blockers / Questions for Kira

None.

## Files changed

- `bridge/queue/*-BRIEF.md` — renamed: 43 files from COMMISSION to BRIEF suffix
- `bridge/watcher.js` — modified: all commission → brief renames (151 lines changed)
- `dashboard/server.js` — modified: heartbeat fields, API route, variable names
- `dashboard/lcars-dashboard.html` — modified: display text, CSS classes, JS variables, API calls
- `bridge/templates/brief.md` — renamed from commission.md, content updated
- `bridge/templates/report.md` — modified: commission → brief in comments
- `docs/contracts/brief-format.md` — renamed from commission-format.md, content updated
- `docs/contracts/queue-lifecycle.md` — modified: commission → brief throughout
- `docs/contracts/report-format.md` — modified: commission → brief (commission_id field preserved)
- `docs/kira/brief-watcher-task.md` — renamed from commission-watcher-task.md, content updated
- `docs/kira/amendment-examples.md` — modified: commission → brief throughout
- `docs/kira/evaluation-rubric.md` — modified: commission → brief throughout
- `KIRA.md` — modified: commission → brief throughout
- `README.md` — modified: commission → brief throughout
- `.claude/CLAUDE.md` — modified: commission → brief throughout
- `.claude/TEAM-STANDARDS.md` — modified: commission → brief
- `.claude/skills/estimate-hours/SKILL.md` — modified: commission → brief
- `.claude/skills/handoff-to-teammate/SKILL.md` — modified: commission → brief
- `.claude/roles/kira/ROLE.md` — modified: commission → brief throughout
- `.claude/roles/kira/LEARNING.md` — modified: commission → brief
- `.claude/roles/obrien/ROLE.md` — modified: commission → brief
- `.claude/roles/dax/LEARNING.md` — modified: commission → brief
- `.claude/roles/sisko/ROLE.md` — modified: commission → brief
- `.claude/roles/ziyal/ROLE.md` — modified: commission → brief
- `.claude/roles/leeta/ROLE.md` — modified: commission → brief
- `bridge/next-id.js` — modified: nextCommissionId → nextBriefId
