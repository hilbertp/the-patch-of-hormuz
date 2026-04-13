# Team Standards

*This is the entry point for every DS9 role. Read this file first, then find your role below and follow the onboarding sequence.*

---

## Session Onboarding

Every role follows the same startup sequence:

1. **Read this file** (you're doing it now)
2. **Find your role** in the roster below — follow the links to your ROLE.md and LEARNING.md
3. **Check your inbox** — run `/check-handoffs` (see Standard #7). This scans your role folder for incoming handoff files and runs a T&T self-audit to verify your previous session's time was logged. If the audit finds a gap, log it before proceeding.
4. **Work** — the standards below apply throughout

---

## Role Roster

| Role | Identity | ROLE.md | LEARNING.md |
|---|---|---|---|
| **Sisko** | Product Manager | `roles/sisko/ROLE.md` | `roles/sisko/LEARNING.md` |
| **Kira** | Delivery Coordinator | `repo/KIRA.md` (repo root) | `roles/kira/LEARNING.md` |
| **Dax** | Architect | `roles/dax/ROLE.md` | `roles/dax/LEARNING.md` |
| **O'Brien** | Implementor | `repo/.claude/CLAUDE.md` | — |
| **Ziyal** | Designer | `roles/ziyal/ROLE.md` | `roles/ziyal/LEARNING.md` |
| **Leeta** | Landing Page Specialist | — | `roles/leeta/LEARNING.md` |
| **Nog** | Code Reviewer | — (not yet created) | — |
| **Bashir** | QA | — (not yet created) | — |

All role paths are relative to `repo/.claude/` unless noted otherwise.

> **Philipp is NOT a role.** Philipp is the human stakeholder and project owner — he sits above all AI roles. Sisko (AI Product Manager) serves Philipp; Sisko is not Philipp. No file, brief, or message should ever equate them.

---

## Standards

These apply to every role, every session, no exceptions.

### 1. Economics Tracking

After completing any significant piece of work, log it to `bridge/timesheet.jsonl`. Full schema and guidance in `skills/estimate-hours/SKILL.md`.

The short version: every entry needs your role, the deliverable name (aggregation key), the phase, a human-equivalent hours estimate, and a note explaining the estimate. If a competent human would bill time for it, log it. When you log time, also run the idea-capture checkpoint — scan the session for any future ideas and append them to `IDEAS.md`.

### 2. Idea Capture

When a future feature idea surfaces — from Philipp, from you, from another role — log it immediately to `IDEAS.md` (repo root). Full guidance in `skills/idea-capture/SKILL.md`.

The short version: if someone describes a capability that doesn't exist yet and it's not in the current bet, append it to IDEAS.md in the standard format. Don't batch, don't wait, don't prioritize. Capture and move on.

**Ownership:** Sisko owns IDEAS.md. All other roles are append-only — they capture ideas but never delete, reorder, prioritize, or promote them. Sisko reads the backlog, groups related ideas into coherent bets, and decides what gets built next. This is a core PM function — the backlog is not a democracy.

### 3. Continuous Learning

Capture learnings and observations as they happen — not in batches, not at the end of a session. Full guidance in `skills/debrief/SKILL.md`.

Two destinations:
- **Your LEARNING.md** (see roster above) — cross-project behavioral patterns. Future sessions of your role inherit these.
- **DEBRIEF.md** (project root) — project-specific observations staged for triage with Sisko.

### 4. Communication Style

You have two audiences. Never mix them.

**With Philipp (the human stakeholder) or Sisko (the AI product manager):** To the point. Business-oriented. Lead with the decision or recommendation, then short reasoning. No preamble, no hedging, no filler. Philipp's time is expensive.

**With robot teammates (in code blocks, handoff files, brief bodies, architecture briefs, ADRs, specs):** Verbose and precise. Spell out every assumption, constraint, and rationale. Leave nothing implicit. These agents start fresh each session — they can't infer what you meant. What you don't write, they don't know.

### 5. Handoff Protocol

When a role needs work from another role, they write a **handoff artifact** and place it in the **receiver's** role folder. This is how roles request help, deliver requirements, or pass completed work to the next stage. No exceptions — verbal requests in conversation don't count. If it's not written down in the receiver's folder, it didn't happen.

**Where it goes:** `roles/{receiver}/inbox/HANDOFF-{short-description}.md`

Example: Sisko asks Dax to architect the relay service → `roles/dax/inbox/HANDOFF-RELAY-SERVICE.md`

**Required header (every handoff artifact):**

```markdown
# {Short Title}

**From:** {sender role} ({sender function})
**To:** {receiver role} ({receiver function})
**Date:** {ISO date}
**Scope:** {bet N | slice N | sprint N} — {one-line scope name}

---
```

The **Scope** line is mandatory. It ties the handoff to a specific bet, slice, or sprint so any role reading it knows exactly where this work belongs in the project. If the scope doesn't exist yet, the sender defines it here and it becomes the canonical name. Example: `Bet 2 — Contributor-facing dashboard` or `Slice 14 — Smart timeout`.

**Required sections:**

1. **Why this exists** — what triggered this handoff and why the receiver is the right role for it
2. **What you're asking for** — the specific deliverable expected back. Be concrete: "an architecture document covering X, Y, Z" not "think about this"
3. **Context the receiver needs** — background, constraints, reference files. Spell out everything — the receiver starts fresh and can't infer what you meant
4. **What NOT to worry about** — explicit scope boundaries so the receiver doesn't over-deliver or wander into another role's territory

**Rules:**

- The artifact lives in the **receiver's inbox** (`roles/{receiver}/inbox/`), not the sender's folder or the receiver's root folder.
- One handoff per artifact. Don't combine unrelated requests.
- The sender is responsible for completeness. If the receiver has to come back with clarifying questions, the handoff was underspecified.
- Handoff artifacts are permanent records. Don't delete them after the work is done — they document why work was requested and what was expected.

**Replies and responses:**

When a role completes a handoff and needs to return something — an architecture recommendation, a design review, a question that blocks progress — they write a **response artifact** and place it in the **original sender's** folder.

Naming: `roles/{original-sender}/inbox/RESPONSE-{short-description}-FROM-{responder}.md`

Example: Dax reviews Sisko's relay service handoff and returns an architecture recommendation → `roles/sisko/inbox/RESPONSE-BET2-ARCHITECTURE-FROM-DAX.md`

The response uses the same header format (From, To, Date, Scope) and references the original handoff by filename.

This means every role-to-role conversation is traceable: you can follow the thread by reading the handoff in the receiver's folder and the response in the sender's folder.

**Future:** Once a team chat room is available, multi-role alignment conversations (where Dax, Ziyal, and Sisko all need to agree before work starts) will move there instead of bouncing artifacts back and forth. Until then, role-to-role files are the communication layer.

**Completing a handoff — invoke the handoff skill:**

Writing the artifact is only step one. Every time a role completes work and passes it to another role, three things must happen: the artifact gets written, economics get logged, and an anchor gets stamped. Use `skills/handoff-to-teammate/SKILL.md` (or invoke `/handoff-to-teammate`) to execute all steps reliably. Skipping the skill means skipping economics tracking and leaving no cutoff marker for the reporting agent.

### 6. Session Wrap-Up

Before ending a session — whether by handoff, user request, or when the conversation is getting long — run `/wrap-up`. Full guidance in `skills/wrap-up/SKILL.md`.

The short version: five steps in order — capture learnings (LEARNING.md + DEBRIEF.md), log hours (timesheet.jsonl), record session token cost (via `bridge/usage-snapshot.js` or manual), run idea checkpoint (IDEAS.md), stamp anchor (anchors.jsonl).

**Token snapshots are handled automatically.** The `/check-handoffs` skill captures the session open snapshot and `/handoff-to-teammate` captures the session close snapshot. You do not need to run `usage-snapshot.js` manually outside of the wrap-up flow.

**Why this is mandatory:** AI sessions start fresh. Context compaction destroys the texture of work — what was tried, how long it took, what surprised you. The wrap-up skill captures this into durable files while the details still exist. The cost of running it is ~2 minutes. The cost of not running it is permanent information loss. This is proven — Dax lost the token-tracking method because she didn't consolidate before her session ended.

**When to run it proactively:** Don't wait for the user to say "wrap up." If the session has produced meaningful work and you haven't consolidated yet, suggest it: "Before we close out, let me run /wrap-up."

### 7. Checking Your Inbox at Session Start

Run `/check-handoffs` at the start of every session (see onboarding step 3). Full guidance in `skills/check-handoffs/SKILL.md`.

This does two things:

1. **T&T self-audit** — checks whether your previous session logged time to the timesheet. If not, it warns you to log before proceeding. This is the failsafe that prevents untracked work from accumulating.
2. **Inbox scan** — finds all `HANDOFF-*.md` and `RESPONSE-*.md` files in your inbox (`roles/{your-role}/inbox/`).

**Critical:** Handoffs live in `roles/{receiver}/inbox/`, not the sender's folder or the receiver's root. The handoff-to-teammate skill writes artifacts into the receiver's inbox. Never search anywhere else for handoffs addressed to you.
