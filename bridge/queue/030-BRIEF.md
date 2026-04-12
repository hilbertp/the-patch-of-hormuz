---
id: "030"
title: "Stranger-friendly README"
goal: "A developer landing on the GitHub repo understands what this is and how to run it in under 2 minutes of reading."
from: kira
to: obrien
priority: normal
created: "2026-04-09T03:16:00Z"
references: "029"
timeout_min: null
---

## Objective

Write a README.md for the repo root that explains what Liberation of Bajor is, who it's for, and how to run it — all targeted at a developer who has never heard of this project. This is the front door for Bet 2's stranger experience.

## Context

- Target user (from Sisko's Bet 2 requirements in `.claude/roles/dax/HANDOFF-BET2-REQUIREMENTS.md`): a developer who uses Claude/Cursor/Copilot for solo coding, is hitting the ceiling of single-agent tools, found the repo via HN/Twitter/friend, has 5 minutes.
- The system: file-based queue where AI agents (roles) coordinate autonomously. Kira writes commissions, O'Brien executes, evaluator reviews, merge happens — all without human intervention.
- Entry point: `docker compose up` (commission 029 builds this)
- Dashboard URL: `http://localhost:4747`

## Tasks

1. Write `README.md` at repo root with these sections:
   - **One-line pitch** — what this is in one sentence (AI agent orchestration through a file-based queue)
   - **Quick start** — clone, `docker compose up`, open browser. Three lines max.
   - **What you'll see** — brief description of the dashboard: roles, active commission, queue, recent completions, system health
   - **How it works** — 1 paragraph explaining the file queue model: Kira writes commissions, watcher detects them, O'Brien executes via `claude -p`, evaluator reviews, amendments or merge happen automatically
   - **The roles** — brief table: Kira (delivery coordinator), O'Brien (implementor), Dax (architect), Nog (code reviewer), etc. Mark which are active vs coming soon.
   - **Project structure** — key directories: `bridge/queue/`, `bridge/watcher.js`, `dashboard/`, `.claude/roles/`
   - **Requirements** — Docker, Anthropic API key
   - **Contributing** — brief note that contributions are welcome, link to issues

2. Tone: direct, no jargon, no Star Trek lore. Developer-to-developer. Show, don't explain.

3. Do NOT include: economics data, internal Kira/Sisko workflows, amendment cycle details, evaluation logic internals. Keep it surface-level — the dashboard shows the rest.

## Constraints

- Max 150 lines. If it's longer, cut.
- No badges, no shields, no status indicators. Clean markdown.
- No LCARS references — Sisko explicitly said "not a Star Trek cosplay."
- Reference `docker compose up` as the primary entry point (depends on commission 029).

## Success Criteria

- [ ] `README.md` exists at repo root
- [ ] Contains quick start with `docker compose up`
- [ ] Explains what the system does in under 3 sentences
- [ ] Lists roles with brief descriptions
- [ ] Shows project structure
- [ ] States requirements (Docker, API key)
- [ ] Under 150 lines
- [ ] No internal jargon, no LCARS, no Star Trek lore
