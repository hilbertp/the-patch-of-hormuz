---
name: handoff-to-teammate
description: "Complete a role-to-role handoff: route to the right receiver(s), write one artifact per receiver, log economics once, stamp one anchor, and tell the user who to open next. Supports single and multi-recipient handoffs. Invoke with /handoff-to-teammate or whenever a role finishes work and passes it on. Every role must use this — it's a global team standard."
---

# /handoff — Route, Write, Track, Anchor, Report

Five steps in order: determine all receivers, write one artifact per receiver, log economics once, stamp one anchor, report to the user. Do not skip steps. Do not write handoff artifacts manually without running this skill.

---

## Step 0: Determine the receiver(s)

A handoff can go to one role or multiple roles simultaneously. Identify every role that needs this work before writing anything.

### Team roster

| Role | Folder | Receives from | What they handle |
|---|---|---|---|
| **Sisko** (PM) | `roles/sisko/` | Anyone | Product decisions, scope approval, bet packaging, escalations |
| **Dax** (Architect) | `roles/dax/` | Sisko, Kira | Technical architecture, feasibility reviews, ADRs, system design — **first stop for anything with technical complexity before it reaches Kira** |
| **Kira** (Delivery Coordinator) | `roles/kira/` | Sisko, Dax, O'Brien, Nog | Slice plans, brief writing, done report evaluation, delivery sequencing — **owns the backend/frontend split: decides which slices go to O'Brien vs Leeta** |
| **O'Brien** (Implementor) | `roles/obrien/` | **Dax + Kira** | Architecture context from Dax (so he knows the system constraints) and implementation briefs from Kira — receives from both |
| **Ziyal** (Designer) | `roles/ziyal/` | Sisko, Kira | UI/UX design briefs, visual design, dashboard designs, frontend HTML prototypes |
| **Leeta** (Landing Page) | `roles/leeta/` | Kira, Ziyal | Frontend/landing page slices Kira routes her way — marketing copy, landing page content |
| **Nog** (Code Review) | `roles/nog/` | Kira, O'Brien | Code review on completed slices |
| **Bashir** (QA) | `roles/bashir/` | Kira, O'Brien | QA and testing on completed slices |

### Known multi-recipient handoffs

These always produce multiple artifacts — do not send to only one:

| Sender | Receivers | Why |
|---|---|---|
| **Dax** (architecture output) | **Kira + O'Brien** | Kira needs it to slice; O'Brien needs it to implement. Both must have it simultaneously. |
| **Kira** (slice plan with mixed scope) | **O'Brien + Leeta** | Backend slices → O'Brien; frontend slices → Leeta; split rather than bundle |

### Natural flow

```
Sisko (scope) → Dax (architecture) → Kira + O'Brien (parallel)
                                       ↳ Kira slices → O'Brien (backend) or Leeta (frontend)
Sisko (scope) → Ziyal (design) → Kira → O'Brien or Leeta
```

**Kira's routing decision when briefing:**
- Backend (Node.js, watcher, relay, bridge, API) → **O'Brien**
- Frontend (HTML, CSS, dashboard, landing page) → **Leeta** (public-facing) or **O'Brien** (product UI)
- Both in one slice → split into two briefs, route separately

**Technical work always goes to Dax before Kira.** Kira should never receive raw technical requirements without architectural guidance from Dax.

### Routing decision

- "Should we build this? What's the scope?" → **Sisko**
- "How should this be built? Any technical complexity?" → **Dax** (before Kira)
- "Architecture output ready" → **Kira + O'Brien** (always both)
- "Sequence, brief, backend vs frontend split" → **Kira**
- "Build the backend / implement" → **O'Brien** (via Kira brief)
- "Build the frontend / landing page" → **Leeta** (via Kira)
- "Design the UI / write the HTML prototype" → **Ziyal**
- "Review this code" → **Nog**
- "QA this slice" → **Bashir**

When in doubt: **Dax before Kira** for anything technical.

---

## Step 1: Write one artifact per receiver

Write a separate handoff file for each receiver in their own folder. Content can be identical or tailored — Dax sending architecture to Kira may emphasize slicing guidance, while the same artifact to O'Brien emphasizes implementation constraints. Either way, each receiver gets their own file.

**File location:** `roles/{receiver}/inbox/HANDOFF-{short-description}.md`

For responses returning work to the original sender:
`roles/{original-sender}/inbox/RESPONSE-{short-description}-FROM-{your-role}.md`

**Required header (each artifact):**

```markdown
# {Short Title}

**From:** {sender role} ({sender function})
**To:** {receiver role} ({receiver function})
**Date:** {ISO date}
**Scope:** {Bet N | Slice N} — {one-line scope name}

---
```

**Required sections:**

1. **Why this exists** — what triggered this handoff and why this receiver is the right role
2. **What you're asking for** — specific deliverable, concrete not vague
3. **Context the receiver needs** — everything spelled out; the receiver starts fresh
4. **What NOT to worry about** — explicit scope boundary

---
## Step 1b: Token snapshot — session close

Run the following command after writing handoff artifacts (Step 1) and before the tt-audit append (Step 1c):

```bash
node bridge/usage-snapshot.js --silent --log
```

This captures the closing token snapshot. The delta between open (check-handoffs) and close (this step) = session cost. Non-blocking — if the script fails silently, the handoff continues.

---

## Step 1c: Append outbound record to tt-audit.jsonl

After writing all handoff artifacts, append **one line** to `bridge/tt-audit.jsonl` for this handoff using a single shell command:

```bash
echo '{ "role": "<sending role, lowercase>", "ts": "'$(date -u +"%Y-%m-%dT%H:%M:%SZ")'", "to": "<receiving role, lowercase>", "ref": "<handoff filename>" }' >> bridge/tt-audit.jsonl
```

- `role` is the current role performing the handoff (the sender), lowercase.
- `ts` is the current UTC timestamp in ISO 8601 format.
- `to` is the primary receiving role, lowercase. For multi-recipient handoffs, use the first receiver.
- `ref` is the handoff filename (e.g. `HANDOFF-BET3-SLICING-FROM-DAX.md`).

One line per handoff invocation. Newline-terminated.

---


## Step 2: Log economics (once per session)

Append **one** entry to `bridge/timesheet.jsonl` covering all work done in this session — regardless of how many artifacts were written. Multi-recipient handoffs do not produce multiple timesheet entries.

Use the full schema from `skills/estimate-hours/SKILL.md`. Key fields: `human_hours` (honest estimate) and `notes` (explain it — a bare number is unauditable).

Also run the idea-capture checkpoint: scan the session for any ideas not yet captured in `IDEAS.md`.

---

## Step 3: Stamp one anchor

Append **one** line to `bridge/anchors.jsonl` — regardless of how many artifacts were written.

**Schema:**

```json
{
  "ts": "ISO 8601 UTC — the moment this anchor is written",
  "role": "your role name, lowercase",
  "scope": "e.g. 'Bet 2 — Contributor-facing relay & dashboard'",
  "deliverable": "same slug used in the timesheet entry",
  "session_start": "ISO 8601 UTC — when this session's work began",
  "timesheet_entries": 1,
  "human_hours_total": 0.0,
  "handoff_artifacts": ["roles/{receiver1}/HANDOFF-*.md", "roles/{receiver2}/HANDOFF-*.md"]
}
```

`handoff_artifacts` is an array — list every artifact written this session.

---

## Why anchors exist

The timesheet is append-only and grows across all sessions, all roles, all bets. The reporting agent (Quark) needs to know which entries are new since the last report.

Protocol: read last anchor → take timesheet entries after that `ts` → report delta → write new anchor. Without anchors, Quark double-counts.

---

## Step 4: Report to the user

After the anchor is stamped, tell the user every role that received a handoff and what to open next.

Format:

> **Handed off to {Role1} and {Role2}.**
> - `{artifact path 1}` → {Role1}
> - `{artifact path 2}` → {Role2}
> Next: open a new context window as **{Role1}** first — {reason}.

Example (Dax handing to Kira + O'Brien):

> **Handed off to Kira (Delivery) and O'Brien (Implementor).**
> - `roles/kira/inbox/HANDOFF-BET2-RELAY-SLICING.md` → Kira
> - `roles/obrien/inbox/HANDOFF-BET2-RELAY-ARCHITECTURE.md` → O'Brien
> Next: open a new context window as **Kira** first — she needs to slice before O'Brien can build.

---

## Summary

| Step | Action | Count |
|---|---|---|
| 0 | Identify all receivers | 1+ roles |
| 1 | Write artifact per receiver | 1 file per receiver |
| 2 | Log economics | 1 timesheet entry |
| 3 | Stamp anchor (artifact array) | 1 anchor entry |
| 4 | Report all receivers and next action | — |
