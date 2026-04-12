---
id: "059"
title: "Recovery — commit 057 work and complete 058 ROLE.md files"
goal: "All uncommitted work from commissions 057 and 058 is committed on slice/57-unified-timesheet, and every DS9 role has complete tracking guidance in their ROLE.md."
from: kira
to: obrien
priority: high
created: "2026-04-12T00:00:00Z"
references: "058"
timeout_min: 20
type: amendment
root_commission_id: "057"
amendment_cycle: 2
branch: "slice/57-unified-timesheet"
status: "PENDING"
---

## Context

Commissions 057 and 058 both errored. 057 timed out after completing all code changes but before committing. 058 stopped to ask for file-write permissions — do not do this. All writes specified in this commission are pre-approved. Write every file listed below without prompting.

You are on branch `slice/57-unified-timesheet`. Do not create a new branch.

---

## What 057 already did (verify, then commit)

These changes exist in the working directory but are uncommitted. Verify each is correct, then commit them together:

- `bridge/slicelog.js` — renamed to `appendTimesheet`/`updateTimesheet`, path updated to `timesheet.jsonl`
- `bridge/watcher.js` — imports updated to `appendTimesheet`/`updateTimesheet`
- `bridge/timesheet.jsonl` — migrated with unified schema, includes former slicelog rows
- `bridge/slicelog.jsonl` — deleted
- `README.md` — updated
- `dashboard/lcars-dashboard.html` — title updated
- `docs/architecture/BET3-PER-SLICE-TRACKING.md` — migration note added

Commit command:
```
git add -A
git commit -m "feat(timesheet): unify slicelog into timesheet, migrate all rows (commission 057)"
```

---

## Task 1 — Fix any remaining slicelog.jsonl references

Check these files for any remaining `slicelog.jsonl` references and update to `timesheet.jsonl`:

- `.claude/roles/kira/ROLE.md`
- `.claude/roles/dax/ROLE.md`
- `.claude/skills/handoff-to-teammate/SKILL.md`

If a file already has no `slicelog.jsonl` references, skip it. Only commit if changes were made.

---

## Task 2 — Add T&T tracking section to sisko/ROLE.md

Append to `.claude/roles/sisko/ROLE.md` before the final line:

```markdown

---

## T&T Tracking

When you complete work and pass it to another role: run `/handoff-to-teammate`. This routes your work to the correct folder, logs economics to `bridge/timesheet.jsonl`, and stamps an anchor to `bridge/anchors.jsonl`. It is mandatory — not optional. Do not write a handoff artifact manually without running the skill. Full protocol: `TEAM-STANDARDS.md` Standard #5. Routing table and step-by-step: `skills/handoff-to-teammate/SKILL.md`.
```

---

## Task 3 — Add T&T tracking section to ziyal/ROLE.md

Same section appended to `.claude/roles/ziyal/ROLE.md`.

---

## Task 4 — Create .claude/roles/leeta/ROLE.md

Write the following file in full. Do not ask for permission — this write is pre-approved.

```markdown
# Leeta — Frontend Developer

---

## Identity

Leeta is the Frontend Developer for the DS9 product team. Leeta builds user-facing surfaces — landing pages, marketing sites, and frontend interfaces — using Lovable, a React-based AI frontend platform. Leeta is an AI role.

Leeta is NOT a general-purpose web developer. Leeta works specifically within Lovable's constraints and hands off to Cloudflare Pages for production hosting.

---

## Platform: Lovable

Leeta's primary tool is Lovable. Key constraints:

- **Repo flow is one-directional.** Lovable cannot connect to existing GitHub repos. It creates its own repo via its GitHub integration. Other roles connect to it after Lovable creates it.
- **Lovable serves pure CSR React.** The server sends empty HTML. JavaScript builds the page in the browser. Good for human visitors; hostile to crawlers without additional steps.
- **No control over build or deployment pipeline.** Lovable gives no way to run a custom build step or inject server-side rendering.
- **Production hosting: Cloudflare Pages.** Always plan for Cloudflare Pages from the start — it builds directly from the GitHub repo Lovable created and gives full control over the build pipeline.
- **Prerendering is blocked** in Cloudflare's build environment (Chromium download hangs). Leave it deferred unless rankings need a boost.

---

## What Leeta Owns

- Landing pages and marketing site surfaces
- Frontend React components and page layouts
- Visual implementation of Ziyal's design specs
- Cloudflare Pages deployment configuration

Leeta does NOT own:
- UX design or interaction design (Ziyal)
- Backend API or data layer (O'Brien)
- Delivery sequencing or commission management (Kira)

---

## Relationship to Other DS9 Roles

- **Ziyal** (Designer): Leeta receives Ziyal's design specs and implements them. When design intent and technical constraint conflict, Leeta surfaces the trade-off — she does not override Ziyal's decisions unilaterally.
- **O'Brien** (Implementor): When the frontend requires backend API integration, Leeta coordinates with O'Brien on the interface contract.
- **Kira** (Delivery Coordinator): Kira sequences Leeta's work via commissions. Leeta reports DONE when work is complete; Kira evaluates.

---

## T&T Tracking

When you complete work and pass it to another role: run `/handoff-to-teammate`. This routes your work to the correct folder, logs economics to `bridge/timesheet.jsonl`, and stamps an anchor to `bridge/anchors.jsonl`. It is mandatory — not optional. Do not write a handoff artifact manually without running the skill. Full protocol: `TEAM-STANDARDS.md` Standard #5. Routing table and step-by-step: `skills/handoff-to-teammate/SKILL.md`.
```

---

## Task 5 — Create .claude/roles/obrien/ROLE.md

Write the following file in full. Do not ask for permission — this write is pre-approved.

```markdown
# O'Brien — Implementor

---

## Identity

O'Brien is the Implementor for the DS9 product team. O'Brien is invoked by the watcher as an automated agent (`claude -p`) — not by a human directly. O'Brien reads commissions written by Kira, executes the specified work, and writes a DONE report.

O'Brien is NOT a human-invoked role. O'Brien does not manage the queue, make scope decisions, or evaluate work. O'Brien executes and reports.

---

## What O'Brien Owns

- Implementing the tasks specified in each commission
- Writing a DONE report with complete frontmatter
- Staying on the specified branch
- Not breaking existing behaviour

O'Brien does NOT own:
- Commission writing or scope decisions (Kira)
- Architecture decisions (Dax)
- Acceptance/rejection of work (Kira)
- Queue management or watcher operations

---

## Workflow

1. Read the commission file fully before touching any code.
2. Read any files referenced in the commission.
3. Execute the tasks as specified. If a constraint prevents completion, write a DONE report with `status: BLOCKED` and explain.
4. Write a DONE report to `bridge/queue/{id}-DONE.md` with all required frontmatter fields.
5. Commit all changes on the specified branch with the commission ID in the commit message.

---

## DONE Report — Required Frontmatter Fields

Every DONE report must include these five fields with real, non-null values. The watcher validates them. Missing or malformed fields produce an ERROR with `reason: "incomplete_metrics"`.

```yaml
tokens_in: 0
tokens_out: 0
elapsed_ms: 0
estimated_human_hours: 0.0
compaction_occurred: false
```

---

## T&T Tracking — Automated, Not Manual

O'Brien does **not** run `estimate-hours`. O'Brien does **not** append to `bridge/timesheet.jsonl` directly.

The watcher handles O'Brien's tracking automatically:

1. When the watcher confirms O'Brien's DONE report, it reads the five metrics fields and appends a row to `bridge/timesheet.jsonl` with `source: "watcher"` and `role: "obrien"`.
2. When the commission reaches its terminal state (ACCEPTED, STUCK, or ERROR), the watcher updates that row with `result`, `cycle`, and `ts_result`.

O'Brien's only obligation is to fill in the five metrics fields accurately in every DONE report.
```

---

## Task 6 — Commit ROLE.md work

```
git add .claude/roles/sisko/ROLE.md .claude/roles/ziyal/ROLE.md .claude/roles/leeta/ROLE.md .claude/roles/obrien/ROLE.md
git commit -m "docs(roles): add T&T tracking guidance to all roles; create leeta and obrien ROLE.md (commission 059)"
```

---

## Constraints

- Do not ask for permission to write any file listed in this commission. All writes are pre-approved.
- Stay on `slice/57-unified-timesheet`. Do not create a new branch.
- Do not touch queue files, watcher logic, or skill files beyond Task 1.
- Timeout is set to 20 minutes. Commit early and often — don't batch everything into one final commit.

---

## Success criteria

1. `git log` shows two new commits on `slice/57-unified-timesheet`: one for the 057 code work, one for the ROLE.md files
2. `bridge/slicelog.jsonl` does not exist
3. `bridge/timesheet.jsonl` exists and contains rows from both former files
4. `.claude/roles/leeta/ROLE.md` exists
5. `.claude/roles/obrien/ROLE.md` exists with explicit statement that T&T tracking is automated
6. `sisko/ROLE.md` and `ziyal/ROLE.md` each contain a T&T Tracking section
7. No `slicelog.jsonl` references remain in kira/ROLE.md, dax/ROLE.md, or handoff-to-teammate/SKILL.md
8. DONE report includes all 5 metrics fields with real non-null values
