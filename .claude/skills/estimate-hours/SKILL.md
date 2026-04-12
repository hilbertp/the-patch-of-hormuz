---
name: estimate-hours
description: "Track token burn and human-equivalent hours for every deliverable. Use this skill after completing any significant piece of work — a brief, a review, a design, an architecture decision, a handoff, planning work. Also triggers on 'log time', 'track hours', 'economics', 'how long would a human take', 'timesheet', 'token cost'. Every role must use this — it's a global team standard."
---

# Estimate Hours — Economics Tracking

This is a global team standard. Every DS9 role uses this skill. No exceptions.

## Why this exists

The team needs to know two things about every piece of work: what it actually cost (tokens) and what it would have cost if a human did it (hours). This data feeds project economics — cost modeling, ROI calculations, and honest retrospection about where AI saves time and where it doesn't.

## What to log

After completing any significant piece of work, append one JSON line to the timesheet:

**Location:** `bridge/timesheet.jsonl`

**Schema:**

```json
{
  "ts": "ISO 8601 timestamp (UTC)",
  "role": "your role name, lowercase (e.g. dax, kira, obrien)",
  "deliverable": "The deliverable this work belongs to — e.g. 'slice-11-nog-gate', 'architecture-plan-v3', 'bet-landing-page'. This is the aggregation key.",
  "phase": "one of: planning, execution, review, housekeeping, fix",
  "brief_id": "brief ID if applicable, or null",
  "task": "One-line description of what you did",
  "human_hours": 0.0,
  "human_role": "What kind of human professional would do this (e.g. Senior Architect, Delivery Coordinator, Senior Developer)",
  "actual_minutes": 0,
  "notes": "Context for the estimate — what made this easy or hard, what a human would need to do"
}
```

## Field guidance

### `deliverable`
This is the grouping key for aggregation. All timesheet entries with the same `deliverable` value roll up together to give total human-hours and total token burn for that deliverable.

Use a short, stable, human-readable slug. Convention: `{type}-{name}`, for example:
- `slice-11-nog-gate` — a numbered delivery slice
- `bet-landing-page` — a product bet or initiative
- `architecture-plan-v3` — a versioned architecture deliverable
- `spike-auth-feasibility` — a feasibility spike
- `housekeeping-branch-cleanup` — meta-work not tied to a feature

Pick the name when you start the work. If you're unsure, ask Sisko or Kira what the deliverable should be called. Once named, use it consistently across all entries for that deliverable — don't rename mid-stream.

### `phase`
- **planning** — scoping, designing, writing specs, architecture decisions
- **execution** — building, implementing, writing deliverables
- **review** — evaluating reports, checking work, acceptance decisions
- **housekeeping** — merges, cleanup, file organization, meta-work
- **fix** — correcting mistakes, amendments, rework

### `human_hours`
This is the core estimate. Ask yourself: if a competent human professional in the `human_role` sat down to do this exact task, with the same context and constraints, how many hours would it take them?

Be honest. Some things AI does faster (reading large codebases, cross-referencing specs). Some things a human does faster (judgment calls that require deep domain expertise, stakeholder conversations). Don't inflate to make AI look good. Don't deflate to seem humble.

**Calibration benchmarks:**
- Reading and evaluating a detailed report against criteria → 0.5–1.0 human hours
- Writing a scoped brief with success criteria → 1.0–2.0 human hours
- Designing a multi-capability architecture → 3.0–6.0 human hours
- Reviewing and merging a branch → 0.5 human hours
- Writing a detailed spec or handoff document → 2.0–4.0 human hours

These are starting points, not rules. Adjust based on complexity.

### `actual_minutes`
Your best estimate of how many minutes of wall-clock time you (the AI role) actually spent on this task. This is approximate — round to the nearest minute.

### `notes`
Explain the estimate. A bare number is hard to audit later. What made this task take the time it did? What would a human need to know or do that you didn't? What did you do that a human wouldn't need to?

## When to log

Log after completing each distinct piece of work, not at the end of a session. One deliverable = one timesheet entry. If a session involves multiple deliverables (e.g., review a report AND brief the next slice), that's two entries.

Don't log trivial actions (reading a file, answering a quick question). The threshold: if a competent human would bill time for it, log it.

## Idea capture checkpoint

Every time you log a timesheet entry, also run the idea-capture skill (`skills/idea-capture/SKILL.md`). Scan the conversation for any future feature ideas that surfaced since the last log and append them to `IDEAS.md` at the repo root. This is the safety net — ideas should be captured inline when they surface, but this checkpoint ensures nothing slips through. If no new ideas surfaced, skip it and move on.

## How to write the entry

Append to the file — never overwrite. Use one JSON object per line (JSON Lines format). The file must remain valid JSONL at all times.

```bash
# Example: appending a timesheet entry
echo '{"ts":"2026-04-08T14:30:00Z","role":"dax","deliverable":"slice-11-nog-gate","phase":"planning","brief_id":null,"task":"Reviewed capability map for Nog code review gate — identified ordering issue in review-before-merge flow","human_hours":1.5,"human_role":"Senior Architect","actual_minutes":4,"notes":"Required reading the full watcher.js to understand the branch lifecycle, then mapping it against the proposed Nog gate. A human architect would need the same codebase understanding."}' >> bridge/timesheet.jsonl
```

## Aggregation

The timesheet is designed for aggregation by `deliverable`. To see total human-equivalent hours and entry count per deliverable:

```bash
# Total human-hours per deliverable
cat bridge/timesheet.jsonl | jq -s 'group_by(.deliverable) | map({deliverable: .[0].deliverable, total_human_hours: (map(.human_hours) | add), entries: length, roles: (map(.role) | unique)})' 
```

This gives a per-deliverable summary showing how many human-hours the work would have taken, how many entries contributed, and which roles were involved. This data feeds project-level economics reporting and ROI calculations.

## Ownership

Every role logs their own entries. Nobody edits another role's entries. The timesheet is append-only — corrections go in as new entries with a note referencing the original, not as edits to past lines.
