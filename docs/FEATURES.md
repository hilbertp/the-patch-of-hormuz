# Liberation of Bajor — Product & Features Reference

*What we've built, how the team works, and where we're going.*
*For contributors, for Ziyal's UX planning, and for Philipp to keep the overview.*
*Owner: Sisko (PM) — 2026-04-12*

---

## Part 1 — The Product

### What this is

Liberation of Bajor is a human-AI hybrid product team running on files. One human works with AI roles that own real functions — product management, architecture, product design, delivery coordination, implementation, evaluation. They communicate through markdown files on disk. Work flows through a pipeline that anyone can see, audit, and extend.

The model comes from Marty Cagan's *Inspired*: a small, empowered, cross-functional product team where product, design, and engineering collaborate to solve problems worth solving. Not a feature factory. Not a ticket queue. A team that discovers what to build, validates it cheaply, kills what doesn't work, and only then commits to delivery.

The twist: most of the team is AI. Every agent starts every session fresh — no memory of the last conversation. So the team's institutional memory lives in files: identity files, learning files, handoff artifacts, an append-only event register, a timesheet. The pipeline is the team's memory.

### Who it's for

**Vibecoders** — you prompt AI to build things. You work with Sisko (PM) and Ziyal (Product Designer) to shape what gets built, then watch it flow through the pipeline. You never touch code. You write briefs, review reports, approve or kill.

**Deep-skill developers** — you want to extend the system itself. The watcher, evaluator, queue state machine, and Ops Center are yours to modify. You can write briefs for O'Brien, change how he's invoked, add new evaluation logic, or build new roles.

**Business roles** — PMs, product designers, coordinators. The handoff protocol, staging gate, and apendment cycle are your tools. You shape the work and verify the outcomes.

All three types work on the same team. The pipeline is designed so they don't step on each other.

### What you can do with it today

**Run the full autonomous pipeline.** `./scripts/start.sh` starts the watcher and Ops Center. Drop a brief into the queue. The watcher picks it up, invokes O'Brien (Claude Code CLI), validates his DONE report, evaluates it against acceptance criteria, and either merges the branch to main or writes an apendment for another try. Five apendment cycles max, then it stops and asks the human.

**Stage and approve work before it executes.** Kira writes briefs to a staging area. Philipp reviews them in the Ops Center — approve, amend with a note, reject, or edit the brief body in place. Nothing executes until the human says go.

**Watch the pipeline in real time.** The Ops Center at `localhost:4747` shows watcher status, current brief, queue depth, recent completions with outcomes, and cumulative token cost. The watcher terminal prints structured lifecycle blocks per brief with progress, timing, and cost.

**Track economics across every role.** Every O'Brien session automatically logs tokens, cost, elapsed time, and human-equivalent hours. Cowork roles log manually via skill. The timesheet is a single JSONL file — one source of truth for what this team costs vs. what it delivers.

**Trace every decision.** The register (`register.jsonl`) is an append-only audit trail. Every state transition — commissioned, done, error, accepted, merged, apendment, stuck — is a JSON line with timestamp, brief ID, and context. If it's not in the register, it didn't happen.

**Hand off work between roles with zero friction.** One skill (`/handoff-to-teammate`) writes the artifact in the receiver's inbox, logs economics, stamps a session anchor, and tells the human who to open next. Every role starts every session by checking its inbox (`/check-handoffs`).

---

## Part 2 — The Team

### Cagan's model, adapted for AI

A Cagan product team has four functions: product management decides what to build and why; design shapes the experience; engineering figures out how and builds it; QA verifies it works. Each function is empowered — they own their decisions within their domain. The PM doesn't dictate implementation. The engineer doesn't dictate UX. They collaborate to find solutions that are valuable, usable, feasible, and viable.

### Four risks, always

Every product idea carries four risks. The team retires them in order of difficulty, not convenience:

**Value risk** — Will anyone want this? (Sisko owns)
**Usability risk** — Can users figure it out? (Ziyal owns)
**Feasibility risk** — Can we build it? (Dax owns)
**Business viability risk** — Does it work for the business? (Sisko + Quark when Quark exists)

The discipline: attack the hardest risk first with the cheapest experiment. If it can't be retired — kill the idea. Days lost, not months.

### The kill discipline

The most important feature of this team is the willingness to kill ideas that don't work. When someone proposes a product idea, the first question is never "how should we build this?" — it's "what's the hardest thing about this, and can we prove it's solvable before we do anything else?" When someone starts listing features: "which of these is the one that, if it doesn't work, makes all the others pointless?" When someone feels stuck: are they stuck on an easy problem (keep going) or a hard one (this is where discovery happens)?

The apendment cap at 5 cycles is the automated version. If a brief can't be completed in 5 tries, the system stops throwing tokens at it and asks the human whether the idea still deserves to exist.

---

### Phase 1 — Discovery: what to build and why

| Role | Function | Identity | Status |
|---|---|---|---|
| **Sisko** | Product Manager | `.claude/roles/sisko/ROLE.md` | Active |
| **Ziyal** | Product Designer (UX/UI) | `.claude/roles/ziyal/ROLE.md` | Active |

**Sisko** decides what gets built and why. He owns product vision, strategy, risk prioritization, kill decisions, success criteria, and the feature backlog (`IDEAS.md`). He does not dictate implementation or UX — he collaborates with Dax and Ziyal to find solutions that satisfy all four risks.

**Ziyal** shapes the experience. She owns user experience, interaction design, visual design, accessibility standards, and design system governance. She is a peer in the product trio — not a service bureau that receives specs and produces pixels.

**Sisko's skills:** Global skills + product-management suite (write-spec, brainstorm, competitive-brief, metrics-review, synthesize-research, stakeholder-update, roadmap-update, sprint-planning).

**Ziyal's skills:** Global skills + design suite:

| Skill | What it does |
|---|---|
| `design-critique` | Structured feedback on usability, hierarchy, consistency |
| `accessibility-review` | WCAG 2.1 AA audit on a design or page |
| `design-handoff` | Developer spec: layout, tokens, props, states, breakpoints, edge cases |
| `design-system` | Audit, document, or extend design system components |
| `ux-copy` | Microcopy, error messages, empty states, CTAs, onboarding |
| `user-research` | Plan and conduct user research studies |
| `research-synthesis` | Distill findings into themes, insights, recommendations |

**How discovery flows:** Sisko writes handoffs to Dax (feasibility) and Ziyal (experience). They respond into Sisko's inbox. The conversation is traceable through the file chain. Once risks are retired, Sisko packages the work and hands it to Dax for architecture or directly to Kira for delivery.

### Phase 2 — Architecture: how it works at the system level

| Role | Function | Identity | Status |
|---|---|---|---|
| **Dax** | Architect | `.claude/roles/dax/ROLE.md` | Active |

**Dax** translates product requirements into technical decisions — file formats, execution models, protocols, error handling, system topology. She does not own implementation (O'Brien) or delivery sequencing (Kira).

**Dax's skills:** Global skills + engineering suite (architecture, system-design, code-review, debug, documentation, testing-strategy, tech-debt, incident-response, deploy-checklist, standup).

**Decision rights:** Technical architecture, technology selection, protocol design, feasibility assessment. Decisions documented as ADRs in `docs/architecture/`.

**Anti-patterns she guards against:** Architecture astronaut syndrome, decision hoarding, ego attachment to prior decisions, ivory tower isolation, scope creep enablement.

**Output rule:** Architecture work always hands off to **both** Kira (for slicing) and O'Brien (for implementation context). Dax never briefs O'Brien directly.

**Architecture documents in the repo:**

| Document | Covers |
|---|---|
| `docs/architecture/BET2-RELAY-DASHBOARD-ARCHITECTURE.md` | System topology, container design, connection model, Ops Center spec |
| `docs/architecture/BET3-PER-SLICE-TRACKING.md` | Per-brief economics tracking schema |
| `docs/architecture/BET3-TT-FAILSAFE-DECISION.md` | T&T audit mechanism design |
| `docs/architecture/DAX-ARCHITECTURE-BRIEF.md` | Dax's standing architecture brief |

### Phase 3 — Delivery: decomposition, staging, approval

| Role | Function | Identity | Status |
|---|---|---|---|
| **Kira** | Delivery Coordinator | `KIRA.md` (repo root) + `.claude/roles/kira/ROLE.md` | Active |

**Kira** is the bridge between product intent and engineering execution. She decomposes architecture into briefs (scoped units of work), stages them for Philipp's review, and manages the apendment cycle.

**Kira's skills:** Global skills. Kira doesn't need specialized plugin skills — her function is coordination, and the global handoff/economics/debrief skills cover it.

**Decision rights:** Brief decomposition, slice sizing, acceptance criteria, apendment decisions, escalation to Sisko.

**Anti-patterns:** Micro-tasking, kitchen-sink briefs, vague objectives, "while you're at it" scope creep, rubber-stamping reports, accepting branch violations, skipping escalation at apendment limit, inventing requirements to avoid escalating.

**What Kira does NOT do:** Rename queue files, delete queue files, write ERROR files, invoke `claude -p`, commit code, expand or contract scope unilaterally.

**Brief writing:** Kira writes to `bridge/staged/`. Format spec in `docs/contracts/brief-format.md`. Required frontmatter: `id`, `title`, `from`, `to`, `priority`, `created`. Required body: Objective, Context, Tasks, Constraints, Success criteria. Slice sizing: 2–7 ACs, 3–10 files, 10–30 min expected. Branch: `slice/{n}-{short-description}`.

**The staging gate — the human's checkpoint:** Briefs land in `bridge/staged/{id}-STAGED.md`. The Ops Center presents them to Philipp:

| Philipp's action | What happens |
|---|---|
| **Approve** | Brief moves to queue. Watcher picks it up. |
| **Amend** | Returned to Kira with a note. She rewrites. |
| **Reject** | Moved to trash. Dead. |
| **Edit body** | Philipp edits in place, then approves. |

**Apendment protocol:** Failed evaluations rewrite the slice in-place with an apendment round section. Same ID throughout. Per-round telemetry in `rounds[]`. Max 5 cycles, then STUCK → Philipp intervenes.

### Phase 4 — Implementation: building the thing

| Role | Function | Identity | Status |
|---|---|---|---|
| **O'Brien** | Backend Implementor | `.claude/CLAUDE.md` (anchor) | Active |
| **Leeta** | Frontend Developer (Lovable) | `.claude/roles/leeta/ROLE.md` | Active |

**O'Brien** is headless. Invoked by the watcher via `claude -p`. Cold start every time — no memory. His anchor file and the project filesystem are his entire context. He reads the brief, executes tasks, writes a DONE report with five mandatory metrics (`tokens_in`, `tokens_out`, `elapsed_ms`, `estimated_human_hours`, `compaction_occurred`).

**O'Brien's skills:** None — he's headless, not a Cowork session. He has the full project filesystem and `.claude/CLAUDE.md` as his anchor.

**Leeta** builds frontend surfaces on Lovable (React + Cloudflare Pages). Receives briefs from Kira and design specs from Ziyal. Lovable-specific — not a general-purpose frontend role.

**Leeta's skills:** Global skills.

**The watcher — automation engine (`bridge/orchestrator.js`):**

Queue state machine:
```
PENDING → IN_PROGRESS → DONE → EVALUATING → ACCEPTED → MERGED
                     ↘ ERROR                ↘ REVIEWED → QUEUED (apendment, same ID)
                                            ↘ STUCK (cycle 5+)
```

Brief lifecycle: watcher finds PENDING → renames to IN_PROGRESS → writes COMMISSIONED to register → pipes brief to `claude -p` → monitors for activity (inactivity timeout: 5 min silence, not wall-clock) → O'Brien writes DONE → watcher validates metrics → valid DONE → EVALUATING → evaluator invoked → verdict.

Crash recovery on startup: stale IN_PROGRESS re-queued, stale EVALUATING re-queued, ACCEPTED with unmerged branch → merge attempted or Philipp alerted.

Token cost: extracted from claude JSON, computed at $15/1M input + $75/1M output (Sonnet 4.6). Written to register and timesheet.

Configuration (`bridge/bridge.config.json`): poll interval, inactivity timeout, heartbeat interval, claude command and args, project directory — all overridable.

### Phase 5 — QA & Evaluation: did we build it right?

| Role | Function | Identity | Status |
|---|---|---|---|
| **Evaluator** | AC verification | Stateless `claude -p` (Kira persona) | Active |
| **Kira** | Manual evaluation fallback | `KIRA.md` | Active |
| **Nog** | Code Reviewer | *Not yet created* | Planned |
| **Bashir** | QA / Testing | *Not yet created* | Planned |

**Autonomous evaluator:** After valid DONE, the watcher evaluates automatically. Reads original brief (ACs) + DONE report → constructs prompt (Kira persona) → invokes `claude -p` (cold, stateless) → parses JSON verdict.

**ACCEPTED** → register event → auto-merge (`git merge --no-ff`) → push. Merge failure: abort, register MERGE_FAILED, alert Philipp.

**APENDMENT_NEEDED** → register event → rewrite slice in-place as QUEUED (apendment) → O'Brien picks it up next cycle.

**STUCK** → cycle 5+ → register STUCK → watcher halts → Philipp intervenes.

**Kira manual fallback** when watcher is offline.

**Planned:** Nog (code reviewer — linting, best practices, architecture compliance) replaces anonymous evaluator. Bashir (QA — test strategy, holistic correctness) pairs with Nog.

### Phase 6 — Operations & Economics: learning and growing

| Role | Function | Identity | Status |
|---|---|---|---|
| **Worf** | DevOps / Tech Lead | *Not yet created* | Planned |
| **Quark** | Economics Tracker | *Not yet created* | Planned |

**Worf** will own CI/CD, rollout/rollback, branch compliance, per-slice technical briefing for O'Brien. Currently split informally across Kira + watcher.

**Quark** will own automated cross-role economics, efficiency metrics, optimization recommendations. Currently manual (Cowork roles) or watcher-automated (O'Brien only).

The infrastructure these roles will use is already built and accumulating data:

| System | What it tracks | Location |
|---|---|---|
| **Register** | Every pipeline state transition (append-only audit trail) | `bridge/register.jsonl` |
| **Timesheet** | All role economics: tokens, cost, human-hours, elapsed time | `bridge/timesheet.jsonl` |
| **T&T audit log** | Outbound handoffs (failsafe against untracked work) | `bridge/tt-audit.jsonl` |
| **Anchors** | Session boundaries (prevents double-counting) | `bridge/anchors.jsonl` |
| **Heartbeat** | Watcher liveness (status, current brief, queue snapshot) | `bridge/heartbeat.json` |

---

## Part 3 — Global Skills & Standards

### Six skills, every role, every session

These enforce the behavioral standards that keep a team of stateless AI agents coherent across sessions. Packaged as a persistent Cowork plugin (`ds9:*`) and also live in `.claude/skills/`.

| Skill | When | What it does |
|---|---|---|
| `/check-handoffs` | Session start | T&T self-audit (warns on missing timesheet). Inbox scan (lists incoming work). |
| `/handoff-to-teammate` | Passing work | Writes artifact in receiver's inbox, logs economics, stamps anchor, tells Philipp who to open next. |
| `/estimate-hours` | After completing work | Appends timesheet entry: role, deliverable, phase, human-hours estimate, notes. |
| `/debrief` | Something learned | Captures to LEARNING.md (behavioral, cross-project) or DEBRIEF.md (project observations). |
| `/idea-capture` | Future idea surfaces | Appends to IDEAS.md. Append-only — Sisko triages later. |
| `/wrap-up` | User ends session or context needs checkpointing | Seven steps: directives → learnings → hours → token cost → ideas → anchor → report. Persists ephemeral session context (Philipp's directives, decisions made) to durable files so scheduled tasks and future sessions have current state. |

### Handoff routing

| If the work is about... | Route to... |
|---|---|
| Scope, priority, kill decisions, escalations | **Sisko** |
| Technical architecture, feasibility | **Dax** |
| Slicing, brief writing, acceptance | **Kira** |
| Backend implementation | **O'Brien** |
| Frontend / landing page | **Leeta** |
| UI/UX design, user research | **Ziyal** |
| Code review | **Nog** (planned) |
| QA / testing | **Bashir** (planned) |

Dax outputs always go to **both** Kira and O'Brien. Kira mixed-scope briefs split to O'Brien (backend) + Leeta (frontend).

### Seven team standards

`.claude/TEAM-STANDARDS.md` — entry point for every role, no exceptions:

1. **Economics tracking** — log hours after significant work. If a human would bill for it, log it.
2. **Idea capture** — log future ideas immediately. Don't batch, don't prioritize. Capture and move on.
3. **Continuous learning** — capture learnings as they happen, not in batches.
4. **Communication style** — terse with Philipp. Verbose and precise with robot teammates. Two audiences, never mixed.
5. **Handoff protocol** — file-based, artifact in receiver's inbox, always use the skill. If it's not written down, it didn't happen.
6. **Session wrap-up** — seven-step consolidation checkpoint. Human-triggered: the user says "wrap up" when they're done with the context window and need the role to persist everything to files. First step: consolidate directives and decisions from the conversation into the role's project anchor file — this is what makes scheduled tasks and headless processes context-aware. Roles should also suggest it mid-session when significant directives have accumulated. 2 minutes. Skipping = permanent information loss.
7. **Inbox check** — T&T audit + inbox scan at session start.

### Session lifecycle

```
Start → read TEAM-STANDARDS.md → read ROLE.md + LEARNING.md
  → /check-handoffs (T&T audit + inbox scan)
  → work
  → /wrap-up or /handoff-to-teammate
  → end
```

### Role infrastructure

Every role has three components at `.claude/roles/{role}/`:

```
ROLE.md       — Identity, responsibilities, decision rights, anti-patterns
LEARNING.md   — Cross-session behavioral memory (written by the role via /debrief)
inbox/        — Incoming work from other roles (written via /handoff-to-teammate)
```

---

## Part 4 — Where We're Going

### What's built (Bet 2 — complete)

The autonomous pipeline: staging gate → brief queue → watcher → O'Brien invocation → metrics validation → autonomous evaluation → auto-merge or apendment loop → STUCK escalation. Ops Center with live API. Economics infrastructure. Role system with identity, learning, inbox, and six global skills. Native launch via `./scripts/start.sh`. 65 briefs processed to date.

### What's next

| Feature | Why it matters |
|---|---|
| **Nog** (code reviewer) | Replaces anonymous evaluator with a proper code review identity — linting, best practices, architecture compliance |
| **Bashir** (QA) | Test strategy and holistic quality assurance as a distinct function from code review |
| **Worf** (DevOps / tech lead) | CI/CD, rollout/rollback, branch enforcement — nobody owns this holistically yet |
| **Quark** (economics tracker) | Automated cross-role cost tracking and optimization recommendations from the data |
| **Vic** (brand voice) | Brand system and tone guidelines across all public-facing surfaces |
| **Slicelog panel** | Visualize `timesheet.jsonl` economics in the Ops Center — token cost per brief, trends, efficiency |
| **Model routing** | Route simple briefs to cheaper models, reserve expensive models for hard problems. Needs measurement first. |
| **`maxApendments` in config** | Currently hardcoded at 5 — should be in `bridge.config.json` |
| **Team chat room** | Multi-role alignment without bouncing handoff files back and forth |
| **Ruflo integration** | Bet 3 may run through Ruflo — smart model routing, agent swarms, workflow learning. Open question: does it preserve files-as-source-of-truth? |

---

## Reference

### Ops Center API

| Endpoint | Method | What it does |
|---|---|---|
| `/` | GET | Ops Center HTML (LCARS theme) |
| `/api/bridge` | GET | Live pipeline state: heartbeat, queue, briefs, recent completions, economics |
| `/api/bridge/staged` | GET | Staged briefs awaiting Philipp's review |
| `/api/bridge/staged/{id}/approve` | POST | Approve brief → queue |
| `/api/bridge/staged/{id}/amend` | POST | Return to Kira with note |
| `/api/bridge/staged/{id}/reject` | POST | Reject to trash |
| `/api/bridge/staged/{id}/update-body` | POST | Edit brief body in place |
| `/api/bridge/review` | POST | Receive evaluator verdict |

### Watcher configuration

| Key | Default | What it controls |
|---|---|---|
| `pollIntervalMs` | `5000` | Queue poll frequency |
| `inactivityTimeoutMs` | `300000` | Kill O'Brien after this many ms of silence |
| `heartbeatIntervalMs` | `60000` | Heartbeat write frequency |
| `claudeCommand` | `"claude"` | CLI binary path |
| `claudeArgs` | `["-p", "--permission-mode", "bypassPermissions", "--output-format", "json"]` | Passed to every invocation |
| `projectDir` | `".."` | cwd for O'Brien (repo root) |

### File map

```
repo/
├── bridge/
│   ├── orchestrator.js          ← Automation engine: poll, invoke, evaluate, merge
│   ├── slicelog.js             ← Timesheet append/update functions
│   ├── next-id.js              ← Sequential brief ID assignment
│   ├── usage-snapshot.js       ← Cowork session cost capture
│   ├── bridge.config.json      ← Watcher configuration
│   ├── queue/                  ← Brief state machine (65 briefs and counting)
│   ├── staged/                 ← Briefs awaiting Philipp's approval
│   ├── trash/                  ← Rejected briefs
│   ├── templates/              ← Brief and report templates
│   ├── register.jsonl          ← Append-only pipeline event log
│   ├── timesheet.jsonl         ← Unified economics log
│   ├── anchors.jsonl           ← Session boundary markers
│   ├── tt-audit.jsonl          ← Handoff audit log
│   ├── heartbeat.json          ← Watcher liveness signal
│   └── bridge.log              ← Structured JSON log
├── dashboard/
│   ├── server.js               ← HTTP server + API
│   └── lcars-dashboard.html    ← Ops Center UI
├── .claude/
│   ├── CLAUDE.md               ← O'Brien's anchor file
│   ├── TEAM-STANDARDS.md       ← Entry point for every role
│   ├── roles/                  ← Per-role: ROLE.md, LEARNING.md, inbox/
│   │   ├── sisko/              ← Product Manager
│   │   ├── ziyal/              ← Product Designer
│   │   ├── dax/                ← Architect
│   │   ├── kira/               ← Delivery Coordinator
│   │   ├── obrien/             ← Backend Implementor
│   │   ├── leeta/              ← Frontend Developer
│   │   ├── nog/                ← Code Reviewer (planned)
│   │   └── bashir/             ← QA (planned)
│   └── skills/                 ← Team skills (also in Cowork plugin)
│       ├── check-handoffs/     ← Session start
│       ├── handoff-to-teammate/ ← Route work between roles
│       ├── estimate-hours/     ← Economics tracking
│       ├── debrief/            ← Learning capture
│       ├── idea-capture/       ← Idea backlog
│       └── wrap-up/            ← Session consolidation
├── docs/
│   ├── FEATURES.md             ← This file
│   ├── CONTRIBUTOR-GUIDE.md    ← Team workflow guide
│   ├── architecture/           ← ADRs and architecture docs
│   └── contracts/              ← Brief format, report format specs
├── KIRA.md                     ← Kira's operational runbook
├── IDEAS.md                    ← Feature backlog (Sisko owns)
├── DEBRIEF.md                  ← Untriaged team observations
├── scripts/start.sh            ← Start Ops Center + orchestrator natively
└── scripts/stop.sh             ← Stop both processes
```
