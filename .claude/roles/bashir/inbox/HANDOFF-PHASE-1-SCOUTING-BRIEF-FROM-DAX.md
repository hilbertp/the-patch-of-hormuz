# Phase 1 — E2E user journey discovery + catalog

**From:** Dax (Architect)
**To:** Bashir (QA)
**Date:** 2026-05-05
**Scope:** Sprint 6 closure — Phase 1 of the Bashir-onboarding-and-e2e-journeys workstream
**Per:** Sisko's ratification dated 2026-05-05 (`.claude/roles/dax/inbox/RESPONSE-BASHIR-ONBOARDING-AND-E2E-JOURNEYS-FROM-SISKO.md`)

---

## Read this first

This is your first non-gate invocation as Bashir. The work is structured discovery — not test authoring (yet) and not gate-running. You're producing a catalog of every end-to-end user journey in the product. The catalog becomes the spec that Phases 2–4 build their tests against. Philipp signs off on the catalog before Phase 2 begins; if your catalog is malformed, Phases 2–4 burn against bad inputs.

You operate with full QA-engineer autonomy per your `ROLE.md`. The brief below is architectural framing — *what* the catalog is, *what* it must contain, *what* you scout from. *How* you do the scouting (notes-first, dive into one area at a time, draft-then-revise) is your call.

The AC-blind discipline still applies, but in an inverted way. For per-slice gate runs, you don't read Rom's diff. For Phase 1 scouting, you DO read the docs, the runbook, and the running product — but you do NOT bake the catalog around what the *current implementation* does. You bake it around what the *user-facing flow* is supposed to do, with the implementation as one input. Document gaps, contradictions, or inconsistencies you find as findings; don't paper over them in the catalog.

## What you're producing

Two artifact classes:

**1. Index file** — `docs/e2e-journeys/INDEX.md`

Lists every journey with: ID, one-line description, category, status (`draft`, `reviewed`, `signed-off`), source-doc citations. Browseable in one screen. Updated atomically with the journey files.

**2. One spec file per journey** — `docs/e2e-journeys/<journey-id>.md`

Each spec follows the structure below. Stable IDs use kebab-case prefixed with `J-`: `J-stage-and-watch-slice`, `J-merge-button-pass`, etc.

## Per-journey spec structure (mandatory)

```markdown
---
id: J-<kebab-case-name>
category: authoring-staging | dispatch-execution | review-verdict | gate-merge | recovery | observability | direct-controls
status: draft
last_reviewed: <ISO date you wrote it>
---

# <Human-readable title>

## What the user is trying to accomplish

<One paragraph in plain English. The user's goal, not the system's mechanism.>

## Preconditions

- <System state assumption 1>
- <System state assumption 2>
- ...

## Steps

1. <User action — what they click, type, or trigger>
2. <Next user action>
3. ...

## Expected outcomes

- <Observable signal 1 — register event, panel transition, file state>
- <Observable signal 2>
- ...

(May be per-step or in summary; whichever maps cleaner to the journey.)

## Known failure modes

- <Failure mode 1 — what can go wrong, what the system should do>
- <Failure mode 2>
- ...

## Sources

- <Path to docs that describe this flow>
- <Path to ADR that governs this state>
- ...

## Open questions

<Anything ambiguous, contradictory, or undocumented you found while scouting. Flag for Sisko/Dax/Ziyal/Worf as appropriate. Empty section is fine if you found none.>
```

## Categories to scout (at minimum)

You produce **at least one journey per category**. Most categories will have 2–5 journeys. If a category has zero journeys, surface it as a finding — it might mean we don't have a real flow there, or it might mean the docs are silent on a real flow.

| Category | Examples to anchor your thinking (not exhaustive) |
|---|---|
| **authoring-staging** | Stage a slice, re-stage a rejected slice, bulk-stage from idea capture, drag-reorder the queue |
| **dispatch-execution** | Slice dispatched and Rom completes, slice errors mid-execution, rate-limit recovery, pause/resume |
| **review-verdict** | Nog accepts, Nog rejects, Round 2 rework, mid-review override |
| **gate-merge** | Press merge button (pass), gate fail with hotfix, gate abort, deferred-during-gate slice queueing |
| **recovery** | Orchestrator crash + restart, your own crash + mutex orphan, main-lock stuck, branch-state corruption |
| **observability** | Watch a slice run live, inspect history, branch topology view, RR dial reading |
| **direct-controls** | Every clickable surface in Ops, every drag interaction, every keyboard shortcut |

The examples are anchor points, not requirements. Discover the actual flows; those are what get specs.

## Sources to scout from

**Documentation:**
- `docs/architecture/BRANCHING-FOR-BASHIR-GATE-ADR.md` — gate state machine, merge flow, recovery semantics
- `docs/architecture/LIFECYCLE-NAMES-ADR.md` — slice state names and transitions
- `docs/architecture/NOG-GATE-ADR.md` — review verdict semantics
- `docs/contracts/slice-format.md`, `slice-lifecycle.md`, `slice-pipeline.md`, `done-report-format.md`, `queue-lifecycle.md`
- `docs/runbooks/RUNBOOK-BASHIR-GATE.md` — operational state and recovery (this is your own runbook; read it from the user's side, not the operator's)
- `repo/.claude/roles/obrien/inbox/HANDOFF-OPS-REDESIGN-SPEC-FROM-ZIYAL.md` — every Ops UI panel, every visible state. **Major source.**
- `PUBLIC-UX-CONCEPT-SPEC.md` — user-facing language and intent (workspace root)
- `repo/AGENTS.md`, `repo/README.md` — high-level system framing

**Existing slice DONE reports** — historical record of what flows exist and how they've been exercised. `bridge/queue/*-DONE.md` for accepted slices is the richest source.

**The running product itself** — the docs describe intent; the running system is the truth. Open Ops, click every button, watch every state transition, observe a slice running live. If you can trigger an error condition (commission a slice with a too-low timeout, kill the orchestrator mid-slice), do it and observe recovery. Journeys must be authored from the truth, not the marketing.

## Cross-role consultations

You don't need permission for any of these — flag a question to the right inbox if you have one:

- **Ziyal (Product Designer)** — UI surface inventory. If her Ops redesign spec doesn't already cover every panel/element/state, ask her for a delta. She owns this.
- **Worf (DevOps)** — recovery flows and operational reliability journeys. The runbook is one source; Worf may have additional edge cases not yet documented.
- **Dax (me)** — architectural flows (lifecycle transitions, gate state machine, branch topology). My ADRs are the canonical source; if you find a contradiction between an ADR and the running system, surface it to me.
- **Sisko (PM)** — flows where the *intent* is unclear (does this flow actually exist? does the user actually do this?). His seat owns the "is this a real flow" question.
- **O'Brien (Tech Lead)** — implementation-side context if you need it, but careful: AC-blind discipline says you don't read Rom's diff. You can ask O'Brien "where does state X get persisted?" but not "show me the code that does this."

If a journey is ambiguous, contested, or undocumented across multiple sources, your default is **flag it as an open question in the journey's spec file and surface it to the right role's inbox.** Don't try to resolve ambiguities yourself — that's not Phase 1's job.

## Acceptance criteria for Phase 1

| # | Criterion |
|---|---|
| 1 | `docs/e2e-journeys/INDEX.md` exists and lists every journey with the metadata above |
| 2 | One spec file per journey, all following the mandatory structure |
| 3 | At least one journey per category from §"Categories to scout"; if a category has zero, that's surfaced as a finding |
| 4 | Every existing slice's user-facing effect is covered by at least one journey (you can validate this by sampling: pick 5 random `bridge/queue/*-DONE.md` reports, identify their user-facing effect, find the journey that covers it) |
| 5 | Every Ops panel from Ziyal's spec has at least one journey that exercises it |
| 6 | Open questions consolidated in a Phase 1 closing memo to Dax (`roles/dax/inbox/RESPONSE-PHASE-1-SCOUTING-FROM-BASHIR.md`) listing every open question across journeys with the role each one routes to |
| 7 | **Philipp signs off on the catalog before Phase 2 begins.** This is a hard gate — Sisko elevated it from a step to a formal acceptance criterion. Surface the catalog to Philipp via Dax (route `roles/dax/inbox/HANDOFF-PHASE-1-CATALOG-FOR-PHILIPP-SIGN-OFF-FROM-BASHIR.md`) with a one-pager summarizing what the catalog captures and what it deliberately omits. Dax routes to Philipp from there. |

## What NOT to do in Phase 1

- **No tests.** This phase is discovery + cataloging. Test authoring is Phase 3.
- **No infrastructure work.** Test runtime, fixtures, helpers — that's Phase 2.
- **No journey-completeness pre-trim.** If you find 30 journeys instead of 15, that's your professional QA call. Don't pre-trim because the number feels high.
- **No catalog-shape redesign.** The mandatory structure above is fixed; if you think it should change, surface it as an open question to Dax. Don't unilaterally use a different shape.
- **No reading Rom's diffs.** AC-blind still applies. You can read product code references in docs to understand state transitions, but the implementation is not the journey spec — the user-facing flow is.

## What to do if you hit a hard block

If a journey is so contradictory or undocumented that you can't even draft a spec:

1. Create the spec file anyway with `status: blocked` and the open questions filled out.
2. Surface the block to the role best positioned to resolve (per the consultation table).
3. Continue scouting other journeys; one block doesn't halt the phase.
4. Phase 1 closes when blocks are either resolved or accepted-as-known-gaps in the closing memo.

## Reference

| Item | Path |
|---|---|
| Your ROLE.md | `roles/bashir/ROLE.md` (will move to `.claude/roles/bashir/ROLE.md` once Phase 0 lands) |
| Sisko's ratification of the broader workstream | `roles/dax/inbox/RESPONSE-BASHIR-ONBOARDING-AND-E2E-JOURNEYS-FROM-SISKO.md` |
| Dax's original architecture brief | `roles/sisko/inbox/HANDOFF-BASHIR-ONBOARDING-AND-E2E-JOURNEYS-FROM-DAX.md` |
| Workspace copy of the original brief (superseded by Sisko's response — refer to that for canonical scope) | `BASHIR-ONBOARDING-AND-E2E-JOURNEYS-BRIEF.md` |
| Auto-memory: Bashir design 2026-04-28 | `project_bashir_design_2026-04-28.md` |
| Branching ADR | `docs/architecture/BRANCHING-FOR-BASHIR-GATE-ADR.md` |
| Lifecycle ADR | `docs/architecture/LIFECYCLE-NAMES-ADR.md` |
| Slice contracts | `docs/contracts/` |
| Bashir runbook | `docs/runbooks/RUNBOOK-BASHIR-GATE.md` |
| Ziyal Ops redesign spec | `repo/.claude/roles/obrien/inbox/HANDOFF-OPS-REDESIGN-SPEC-FROM-ZIYAL.md` |

— Dax
