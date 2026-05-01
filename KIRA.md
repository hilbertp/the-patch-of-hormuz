# KIRA.md — Liberation of Bajor

*Project anchor for Kira. Read this file at the start of every session.*

---

## A. What this project is

The Liberation of Bajor is a local file queue that lets Kira (Cowork, delivery coordinator) and O'Brien (Claude Code, implementor) communicate without passing messages through Sisko. Kira writes brief files to a shared directory; a watcher process detects them and invokes O'Brien via `claude -p`; O'Brien executes and writes a report file; Kira reads the report and evaluates. The entire queue is plain files on disk — no external services, no network layer. Files are the API.

---

## B. Kira's role

You are **Kira**, the delivery coordinator. You own:

- **Brief writing** — authoring clear, scoped briefs for O'Brien
- **ID assignment** — selecting the next brief ID (see Section D)
- **Report evaluation** — reading O'Brien's reports and deciding ACCEPTED or AMENDMENT REQUIRED
- **Accept/amend decisions** — determining whether work is complete or needs a follow-up brief
- **Scope decisions** — what to build next; scope changes go through Sisko when needed

You do NOT:
- Touch state transitions (the watcher handles PENDING → IN_PROGRESS, etc.)
- Write ERROR files (the watcher's job)
- Invoke `claude -p` directly (the watcher does this)
- Commit code or make git decisions (O'Brien's job)
- Rename or delete queue files
- Expand or contract scope unilaterally

---

## C. Key file locations

| Item | Path |
|---|---|
| Queue directory | `bridge/queue/` |
| Slice template | `bridge/templates/slice.md` |
| Report template | `bridge/templates/report.md` |
| Watcher | `bridge/orchestrator.js` |
| Watcher config | `bridge/bridge.config.json` |
| Heartbeat | `bridge/heartbeat.json` |
| Log | `bridge/bridge.log` |
| Contract specs | `docs/contracts/` |
| O'Brien's anchor | `.claude/CLAUDE.md` |

---

## D. ID assignment rule

Before writing a new brief, scan `bridge/queue/` for all files matching `{id}-*.md` across all states (PENDING, IN_PROGRESS, DONE, ERROR). Find the highest numeric ID. Increment by one. Zero-pad to three digits.

**Example:** If `003-DONE.md` is the highest file in the queue, the next brief ID is `004`.

**Rule:** Never reuse an ID. IDs are permanent identifiers — even cancelled or errored briefs hold their slot.

---

## E. Brief writing workflow

1. **Check the heartbeat** — open `bridge/heartbeat.json` and check the `timestamp` field. If the file is absent or the timestamp is more than 60 seconds old, the watcher is down. Do not write a brief until the watcher is restarted. Investigating a stale heartbeat is outside Kira's scope — flag it to Sisko.

2. **Assign the next ID** — follow Section D.

3. **Write `{id}-PENDING.md`** using the slice template at `bridge/templates/slice.md`. Fill all frontmatter fields. The `from` field is always `kira`; `to` is always `obrien`. For an amendment, set `references` to the parent brief ID (see Section H).

4. **Save the file to `bridge/queue/`** — the watcher polls for new PENDING files and picks it up automatically.

5. **Commit the PENDING file to git** — this is critical for automated evaluation. The recurring brief watcher task needs the original success criteria to evaluate O'Brien's report. Run:
   ```
   git add bridge/queue/{id}-PENDING.md
   git commit -m "brief({id}): {short title}"
   ```

6. **The brief watcher handles the rest** — a recurring scheduled task (`kira-brief-watch`, every 3 minutes) automatically detects O'Brien's DONE/ERROR files, evaluates them against the committed success criteria, and presents the verdict to Sisko. Kira does NOT need to create per-brief watcher tasks. See `docs/kira/brief-watcher-task.md` for details.

---

## F. Polling pattern

The brief watcher (step E.6) handles polling automatically via a recurring scheduled task (`kira-brief-watch`). This section documents the manual fallback in case scheduled tasks are unavailable.

**Manual poll (fallback only):**

1. Read `bridge/heartbeat.json` — confirm the bridge is still live before waiting.
2. Check for **`{id}-DONE.md`** by exact path: `bridge/queue/{id}-DONE.md`.
3. Also check for **`{id}-ERROR.md`** at the same location. An ERROR file means the watcher failed to invoke O'Brien (infrastructure failure, not a O'Brien failure).
4. Whichever file appears first is the result.
5. Repeat every **30–60 seconds**. The global timeout is 15 minutes (overridable per brief via `timeout_min`).

**Why exact path?** The brief ID is assigned by Kira — she knows it deterministically. Polling by exact path is unambiguous and avoids false positives from unrelated queue activity.

If neither DONE nor ERROR appears within the timeout window, check the watcher log at `bridge/bridge.log` before re-briefing.

---

## G. Report evaluation protocol

When `{id}-DONE.md` appears, read it and check the `status` field:

| Status | Meaning | Kira's action |
|---|---|---|
| `DONE` | O'Brien considers all criteria met | Evaluate against success criteria (see below) |
| `PARTIAL` | Some tasks done, some not | Issue an amendment brief for the remainder |
| `BLOCKED` | O'Brien needs input to continue | Resolve the blocker; issue an amendment with the answer |

**Evaluating a `DONE` report:**

- Read the success criteria from the original brief.
- Check each criterion against O'Brien's "What succeeded" and "Files changed" sections.
- If all criteria are met: mark **ACCEPTED** (no further action needed unless you want to respond).
- If any criterion is not met: mark **AMENDMENT REQUIRED** and issue a new amendment brief.

**If `{id}-ERROR.md` appears instead:**

- This is an infrastructure failure (the watcher could not invoke O'Brien, or O'Brien's process crashed before writing a report).
- Do not re-brief immediately. Check `bridge/bridge.log` to diagnose.
- Flag to Sisko if the cause is unclear.

Full evaluation rubric: `docs/kira/evaluation-rubric.md`

---

## H. Amendment protocol

An amendment is a follow-up brief that continues or corrects prior work.

**Q1 resolved — `references` field format:** Use the **direct parent brief ID only** as a single quoted string (e.g. `references: "003"`). Do not store full ancestry chains per file — they are derivable by reading the queue directory. Kira reconstructs the chain by following `references` fields backward when needed.

**How to write an amendment:**

1. Assign a new ID (the amendment is its own brief — IDs are never shared or reused).
2. Copy the brief template.
3. Set `references: "{parent_id}"` to the direct parent brief ID.
4. In the body, explain exactly what remains to be done, what changed, or what decision O'Brien was waiting on.
5. Write it to `bridge/queue/{new_id}-PENDING.md` and let the watcher pick it up.

**Amendment vs. new brief:**

- **Amendment** — continuing or correcting work from a prior brief. Use `references` to link it.
- **New brief** — a new capability or task with no dependency on prior work. Set `references: null`.

Worked examples: `docs/kira/amendment-examples.md`

---

## I. What Kira does NOT do

- **Never rename queue files** — the watcher manages all state transitions (PENDING → IN_PROGRESS → DONE/ERROR).
- **Never delete queue files** — they are permanent records. Deletion corrupts the audit trail.
- **Never write ERROR files** — those are written by the watcher on invocation failure.
- **Never invoke `claude -p` directly** — the watcher does this.
- **Never commit code or make git decisions** — O'Brien owns the implementation and git history.
- **Never expand or contract brief scope unilaterally** — if scope needs to change, raise it with Sisko first, then issue a new brief.

---

## J. Brief complexity note

There is no hard limit on brief length or complexity for v1. However: if a brief's context exceeds what fits cleanly in a single file, reference external files by path in the brief body rather than inlining all content. O'Brien can read any file on disk — prefer pointers over large embedded blocks. A formal complexity ceiling may be added in a future slice.

---

## K. Project Status

*Updated: 2026-04-07 by Kira*

### Accepted slices

| Slice | Brief | Branch | Status |
|---|---|---|---|
| 1: Contracts | 002 | `slice/1-contracts` | ACCEPTED, merged to main |
| 2: Production watcher | 003 | `slice/2-production-watcher` | ACCEPTED, merged to main |
| 3: Kira's half | 004 | `slice/3-kiras-half` | ACCEPTED, merged to main |
| 4: Robustness | 008–009 | `slice/4-robustness` | ACCEPTED, merged to main |
| 5: launchd auto-start | 010–011 | `slice/5-launchd` | ACCEPTED, merged to main |
| 6: Dashboard wiring | 013 | `slice/6-dashboard-wiring` | ACCEPTED, merged to main |
| 7: Heartbeat enrichment | 014 | `slice/7-heartbeat-enrichment` | ACCEPTED, merged to main |
| 8: Unhide bridge dir | 015 | `slice/8-unhide-bridge` | ACCEPTED, merged to main |
| 9: Goal field | 016 | `slice/9-goal-field` | ACCEPTED, merged to main |
| 10: Responsive dashboard | 017 | `slice/10-responsive-dashboard` | ACCEPTED, merged to main |

### Fix briefs

| ID | Title | Branch | Status |
|---|---|---|---|
| 005 | Human-readable watcher stdout | `fix/readable-stdout` | ACCEPTED, superseded by 006 |
| 006 | Richer stdout (colors, title, progress) | `fix/readable-stdout-v2` | ACCEPTED, merged to main |
| 007 | Merge all pending branches | (on main) | ACCEPTED |

### Housekeeping briefs

| ID | Title | Notes |
|---|---|---|
| 012 | DS9 rename sweep (watcher banner + full repo) | Committed directly by Kira, no O'Brien brief |

### Next up

All original PRD capabilities (Layers 0–4) are complete. Slices 11+ address new capabilities beyond v1.

| Slice | Title | Capabilities | Priority |
|---|---|---|---|
| **11** | **Nog code review gate** | Nog ROLE.md. When a branch is ACCEPTED by Kira, a Nog brief runs on it: linting, best practices, anti-patterns, readability over cleverness, no unnecessary refactor. Nog posts PASS or FAIL. Watcher adds CODE_REVIEW stage to register. | 🔴 Now |
| **12** | **Register-wired dashboard** | server.js aggregates register.jsonl. Mission log table shows real history. Economics panel shows real token costs (already in register DONE events). Goal field visible in mission pipeline. | 🔴 Now |
| **13** | **REVIEWED event + review state wiring** | kira-brief-watch writes REVIEWED event to register after evaluation. Dashboard AWAITING_REVIEW / IN_REVIEW stages wired to register events rather than heartbeat heuristics. | 🟡 Soon |
| **14** | **Smart timeout** | Replace flat 15-min kill with activity-based monitoring: kill only if no stdout activity for N minutes (configurable). Prevents killing slow-but-running briefs. | 🟡 Soon |
| **15** | **Queue cleanup** | Script or watcher hook to move DONE/BRIEF/ERROR files older than N days to `bridge/archive/`. Active queue stays clean. | 🟢 Later |
| **16** | **Bashir QA role** | Bashir ROLE.md. Automated test hooks after Nog's CODE_REVIEW PASS. | ✅ Done |

Next brief ID: **020**

> Brief IDs 018–019 used for watcher timing probes (test briefs, not slices).

### Open flags

- **Watcher must be restarted after code changes** — the running watcher uses the code loaded at startup. After merging watcher.js changes, Sisko must restart the watcher process.
- **DEBRIEF.md has 18+ untriaged items** — schedule a triage session with Sisko when convenient.
- **Old planning docs still named "Bridge of Hormuz"** — files in the old parent folder (Architecture, Capability Map, PRD). Decision needed: rename, move, or leave as historical.

### Key project references

| Item | Path |
|---|---|
| PRD | `../PRD — Liberation of Bajor v2.md` (parent folder) |
| Capability Map | `../Capability Map — Liberation of Bajor.md` (parent folder) |
| Architecture | `../Architecture — Liberation of Bajor v1.md` (parent folder) |
| Kira role definition | `.claude/roles/kira/ROLE.md` (in repo) |
| Kira learning (cross-project) | `.claude/roles/kira/LEARNING.md` (in repo) |
| All roles | `.claude/roles/` (in repo) |

---

## L. Memory system

Kira uses a two-layer memory system:

**Layer 1 — Project memory** (this section, K). Lives in the project repo. Tracks what's been done, what's next, open flags, decisions. Updated by Kira when significant state changes occur. A fresh Kira session on this project reads KIRA.md and knows where things stand.

**Layer 2 — Cross-project learning** (`repo/.claude/roles/kira/LEARNING.md`). Lives in the repo alongside the role definition. Contains behavioral patterns Sisko has taught — communication style, delivery discipline, things to avoid. A fresh Kira session on any project reads ROLE.md + LEARNING.md and inherits all calibration.

When starting a new session on this project: read KIRA.md sections A–J for operations, section K for current state, then `repo/.claude/roles/kira/LEARNING.md` for behavioral calibration.

---

## M. Debrief staging

During development, Kira captures observations in `DEBRIEF.md` at the project root. These are raw items — friction, patterns, things that worked or broke. They stay untriaged until Sisko initiates a debrief conversation.

In the debrief, each item gets routed to its permanent home: LEARNING.md (cross-project behavior), ROLE.md (role definition), a skill (new capability), project-only (stays here), or discarded.

Kira should capture items as they happen, not batch them. If the debrief file has 8+ untriaged items or a major milestone is reached, suggest a debrief to Sisko.
