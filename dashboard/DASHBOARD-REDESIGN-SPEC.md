# LCARS Dashboard Redesign — Functional UX/UI Spec

**Author:** Ziyal (Product Designer)
**Date:** 2026-04-07
**Status:** Draft for Philipp's review
**Surface:** `repo/dashboard/lcars-dashboard.html`

---

## 1. Design goal

Philipp commissions a slice, walks away, and comes back later. The dashboard must answer three questions in under 5 seconds:

1. **Where is my slice?** — which lifecycle stage, who owns it right now, how long they've held it.
2. **Is anything stuck or broken?** — stale stages, errors, watcher down.
3. **What happened while I was gone?** — completed slices, apendments, timing.

Everything else is secondary. Economics, ROI, human-equivalent hours — those are nice-to-have panels that earn their place only after the primary questions are answered.

---

## 2. Information architecture

### Panel hierarchy (top to bottom = highest to lowest priority)

```
┌─────────────────────────────────────────────────────────┐
│  A. HEADER BAR — project name, live clock, system pulse │
├─────────────────────────────────────────────────────────┤
│  B. ACTIVE SLICE TRACKER  (hero panel, largest element) │
│     Pipeline visualization: stage → stage → stage       │
│     Current owner badge + elapsed time + stuck warning  │
├──────────────────────┬──────────────────────────────────┤
│  C. SLICE HISTORY    │  D. CREW MANIFEST               │
│     Table of past    │     Who exists, who's active,    │
│     slices: outcome, │     what they're doing right now │
│     duration, amends │                                  │
├──────────────────────┴──────────────────────────────────┤
│  E. SYSTEM HEALTH BAR — watcher status, heartbeat age,  │
│     queue counts, error flag                            │
└─────────────────────────────────────────────────────────┘
```

### Responsive stacking (narrower viewports)
- 1440px+: B full width, C and D side by side, E full width.
- 1100px: B full width, C full width, D full width, E full width.
- 850px: same as 1100 but font sizes and padding compress.

---

## 3. Panel specifications

### A. Header bar

Same concept as current top bar. No changes needed except:
- Replace static "SYS NOMINAL" pill with a **live system pulse** that reflects watcher state: `NOMINAL` (green) / `IDLE` (amber) / `DOWN` (red). Derived from heartbeat.json.
- Clock already works. Keep it.

### B. Active slice tracker (hero panel)

This is the centerpiece. It replaces the current "Mission Lifecycle Pipeline" section entirely.

**What it shows when a slice is active:**

```
┌─────────────────────────────────────────────────────────┐
│  SLICE 6 — Implement dashboard live-data wiring         │
│                                                         │
│  ○ ── ○ ── ○ ── ● ── ○ ── ○ ── ○ ── ○ ── ○ ── ○      │
│  VIS  COM  PND  IP   AWR  REV  ACC  CR   MRG  DONE     │
│                  ▲                                       │
│            ┌─────┴──────┐                               │
│            │  O'BRIEN    │  ← current owner badge       │
│            │  12:34      │  ← time in this stage        │
│            └────────────-┘                               │
│                                                         │
│  Commissioned 14:22 · Entered IN PROGRESS 14:25         │
│  No apendments yet                                      │
└─────────────────────────────────────────────────────────┘
```

**Stage abbreviations** (for the pipeline nodes):
| Abbreviation | Full stage | Owner |
|---|---|---|
| VIS | VISUALIZING | Philipp |
| COM | COMMISSIONED | Kira |
| PND | PENDING | Watcher |
| IP | IN PROGRESS | O'Brien |
| AWR | AWAITING REVIEW | — (transition) |
| REV | IN REVIEW | Kira |
| ACC | ACCEPTED | — (gate) |
| CR | CODE REVIEW | Nog |
| MRG | MERGING | Kira |
| DONE | MERGED | — (terminal) |

**Owner badge:** The pipeline shows a prominent badge below the active stage node. The badge contains the role name and elapsed time in that stage. Color-coded to the role's crew color.

**Stuck detection:** If elapsed time exceeds a threshold, the badge turns amber then red:
- O'Brien IN PROGRESS: amber at 15min, red at 30min
- Kira IN REVIEW: amber at 5min, red at 15min
- Nog CODE REVIEW: amber at 5min, red at 15min
- Watcher PENDING: amber at 30s, red at 2min

These thresholds are configurable (could live in bridge.config.json).

**Apendment cycle:** If a slice is rejected and enters apendment, the pipeline shows a loopback arrow between REV and IP with a counter: "Apendment 1", "Apendment 2", etc.

**What it shows when no slice is active:**

```
┌─────────────────────────────────────────────────────────┐
│  NO ACTIVE SLICE                                        │
│                                                         │
│  Last completed: Slice 5 — Watcher terminal overhaul    │
│  Completed 2026-04-06 at 07:10 · Duration: 18m 22s     │
│  Result: ACCEPTED (no apendments)                       │
└─────────────────────────────────────────────────────────┘
```

This is much more useful than the current "NO ACTIVE MISSION" text — it tells you what happened last.

### C. Slice history table

Replaces the current "Commission History" table. The key change: this is organized by **slice**, not by individual commission.

| Column | Description | Source |
|---|---|---|
| Slice | Slice number | Derived from commission title/metadata |
| Title | Human-readable description | Commission frontmatter `title` |
| Result | MERGED / REJECTED / ERROR / IN PROGRESS | Derived from final event in register |
| Apendments | Count of reject→retry cycles | Count of REJECTED events per slice |
| Duration | Wall-clock time from COMMISSIONED to MERGED | Register timestamps |
| Stages | Mini inline pipeline (dots showing which stages had delays) | Register stage events |

Rows are sorted newest-first. The active slice (if any) appears at the top with a highlighted row. Completed slices below in reverse chronological order.

**No more individual commission rows.** Commissions are implementation details. Philipp thinks in slices. The merge commission, the initial work commission, the apendment commission — those all belong to one slice.

### D. Crew manifest

Replaces the current static crew sidebar. Changes:

1. **Add Ziyal** (Product Designer) and make **Sisko** (Product Manager) show as an AI role rather than implying it's Philipp. Philipp is the human stakeholder above all roles.
2. **Dynamic status:** Derive from register events. If the most recent register event for a slice is IN_PROGRESS, O'Brien is ACTIVE. If it's IN_REVIEW, Kira is ACTIVE. Everyone else is STANDBY or OFFLINE.
3. **Current activity line:** Below each crew member's name, show what they're doing: "Executing Slice 6" / "Reviewing Slice 6 report" / "Standby". This is derived from the active slice's current stage.
4. **Remove watcher process details from this panel.** The watcher is not a crew member — it's infrastructure. It belongs in the system health bar (panel E).

### E. System health bar

Replaces the current bottom bar. Consolidates all infrastructure status:

| Element | Current state | What changes |
|---|---|---|
| Watcher status pill | Already works | Keep, move watcher details here from sidebar |
| Last heartbeat | Already works | Keep, show age in seconds: "3s ago" not just timestamp |
| Queue counts | Shown as stat cards above the table | Move here as compact inline: `Q: 0 waiting · 1 active · 14 done · 1 error` |
| Error flag | Not visible enough | If error count > 0, show a red alert: `1 ERROR — tap to view` |
| Branch | Shows "MAIN" statically | Show actual current branch from heartbeat or git |

The stat cards in the current center-top section (Waiting / In Progress / Complete / Failed / For Review) are **removed**. They duplicate information that's better shown in context — the active slice tracker shows what's in progress, the history table shows what's complete, and the health bar shows queue counts.

---

## 4. Data gaps — what must change before the UI can work

This is the critical section. The current data layer cannot support the redesigned dashboard.

### 4.1 Register events (register.jsonl)

**Current state:** Only logs COMMISSIONED and DONE. Two events per commission.

**Required:** The register must log every lifecycle transition as a distinct event. Each event needs:

```jsonl
{"ts":"...","id":"019","slice":"5","event":"COMMISSIONED","owner":"kira","title":"..."}
{"ts":"...","id":"019","slice":"5","event":"PENDING","owner":"watcher"}
{"ts":"...","id":"019","slice":"5","event":"IN_PROGRESS","owner":"obrien"}
{"ts":"...","id":"019","slice":"5","event":"DONE","owner":"obrien","durationMs":32479}
{"ts":"...","id":"019","slice":"5","event":"IN_REVIEW","owner":"kira"}
{"ts":"...","id":"019","slice":"5","event":"ACCEPTED","owner":"kira"}
{"ts":"...","id":"019","slice":"5","event":"CODE_REVIEW","owner":"nog"}
{"ts":"...","id":"019","slice":"5","event":"MERGING","owner":"kira"}
{"ts":"...","id":"019","slice":"5","event":"MERGED","owner":"kira"}
```

Key additions vs. current:
- **`slice` field** — groups commissions under their parent slice
- **`owner` field** — who triggered this transition
- **`event` expanded** — all 10 lifecycle stages, plus REJECTED and APENDMENT
- Every transition is a separate line, enabling duration calculation per stage

### 4.2 Commission frontmatter

**Current state:** Has `id`, `title`, `from`, `to`, `status`, `created`, `completed`.

**Required additions:**
- `slice` — the slice number this commission belongs to
- `stage` — current lifecycle stage (not just PENDING/IN_PROGRESS/DONE/ERROR)

### 4.3 Server API (`/api/bridge`)

**Current state:** Returns `{ heartbeat, queue, commissions }`. Queue counts only know 4 states. Commissions are flat list with no slice grouping.

**Required:** The API response needs a `slices` array:

```json
{
  "heartbeat": { ... },
  "slices": [
    {
      "number": 6,
      "title": "Dashboard live-data wiring",
      "stage": "IN_PROGRESS",
      "owner": "obrien",
      "stageEnteredAt": "2026-04-07T14:25:00Z",
      "stageElapsedSeconds": 734,
      "commissionedAt": "2026-04-07T14:22:00Z",
      "apendments": 0,
      "commissions": ["020"],
      "events": [
        {"ts":"...","event":"COMMISSIONED","owner":"kira"},
        {"ts":"...","event":"PENDING","owner":"watcher"},
        {"ts":"...","event":"IN_PROGRESS","owner":"obrien"}
      ]
    }
  ],
  "queue": { "waiting": 0, "active": 1, "done": 14, "error": 1 }
}
```

The server builds this by reading register.jsonl and grouping events by slice number. The `events` array for each slice gives the dashboard everything it needs to render the pipeline, calculate durations, and show history.

### 4.4 Heartbeat

**Current state:** Adequate for watcher health. No changes needed except:
- Add `current_slice` field (slice number, not just commission ID)

---

## 5. What gets removed from the current dashboard

| Current element | Verdict | Reason |
|---|---|---|
| Stat cards (Waiting/Active/Done/Error/Review) | **Remove** | Redundant — counts belong in health bar, active status belongs in hero panel |
| Economics panel (Session Costs, Human-Equivalent Hours, ROI Signal) | **Redesign** | Stays, but rewired to real data. Hardcoded fiction replaced with live token burn + human-hours equivalent tracking. See Section 5.1 |
| Commission History table (individual commissions) | **Replace** | Becomes slice history table — grouped by slice, not by commission |
| Static crew indicators | **Replace** | Becomes dynamic crew manifest derived from register |
| Watcher details in sidebar | **Move** | Goes to system health bar |

### 5.1 Economics panel — redesigned, not removed

The economics panel stays but becomes real. It tells the ROI story with three cost layers, not hardcoded fiction.

**The three columns:**

| Layer | What it tracks | Data source |
|---|---|---|
| **AI token burn** | Actual tokens consumed + cost per role per session | Token tracking skill (new) → token tracker DB/sheet |
| **Simulated human team** | Estimated hours a legacy human team would need for the same work | Estimate-hours skill (exists as concept in timesheet.jsonl) → same tracker |
| **Philipp's actual hours** | Real time Philipp spent on the project | Manual input or tracked session time |

**Panel layout (right sidebar, replaces current economics section):**

```
┌──────────────────────────┐
│  ECONOMICS               │
├──────────────────────────┤
│  AI Cost (this session)  │
│  $2.34                   │
│  ├ O'Brien   $1.80       │
│  ├ Kira      $0.42       │
│  └ Nog       $0.12       │
├──────────────────────────┤
│  Human Equiv. (est.)     │
│  6.5h → €650             │
│  ├ Planning    2.0h      │
│  ├ Execution   3.5h      │
│  ├ Review      0.5h      │
│  └ Correction  0.5h      │
├──────────────────────────┤
│  Philipp's Actual Time   │
│  22 min                  │
├──────────────────────────┤
│  Efficiency              │
│  Human: €650 / 6.5h      │
│  AI:    $2.34 / 22min    │
│  Multiplier: 130×        │
└──────────────────────────┘
```

The key difference from the current panel: every number is real, derived from tracked data. The multiplier is computed, not asserted.

**Token tracking skill (new capability needed):**

Every role session (Kira in Cowork, O'Brien in Claude Code, Nog in Claude Code) should run a reporting step at session end that logs:
- Role name
- Slice number
- Tokens in / tokens out
- Computed cost (using current API pricing)
- Timestamp

This gets appended to a token tracker (could be a JSONL file like `bridge/token-burn.jsonl`, or a sheet, or a lightweight DB — implementation detail for Dax/O'Brien).

The estimate-hours skill already has a concept in timesheet.jsonl. It needs to run alongside token tracking so both numbers land in the same system, making the comparison trivial.

The server API exposes an `/api/economics` endpoint (or adds an `economics` key to the existing `/api/bridge` response) that aggregates this data for the dashboard.

---

## 6. Implementation sequencing

This redesign cannot ship as one commission. It has backend prerequisites.

**Phase 1 — Data layer (O'Brien, 1-2 commissions)**
1. Enrich register.jsonl with all lifecycle events + `slice` + `owner` fields
2. Add `slice` field to commission frontmatter
3. Update server.js to build and serve the `slices` array from register data

**Phase 2 — Dashboard UI (O'Brien, 1-2 commissions)**
1. Replace mission pipeline with active slice tracker (hero panel)
2. Replace commission table with slice history table
3. Update crew manifest to be dynamic
4. Consolidate bottom bar into system health bar
5. Remove stat cards, redesign economics panel as placeholder with real structure

**Phase 3 — Economics data layer (O'Brien + Dax, 1-2 commissions)**
1. Token burn tracking skill — runs per role per session, logs to `bridge/token-burn.jsonl`
2. Estimate-hours skill — runs alongside, logs to same tracker or timesheet.jsonl
3. Server endpoint to aggregate economics data for the dashboard
4. Wire economics panel to real data

**Phase 4 — Polish (O'Brien, 1 commission)**
1. Stuck detection thresholds + visual warnings (ship with defaults, tune in production)
2. Apendment cycle loopback visualization with reject reason on hover/tap
3. "Last completed slice" display for idle state
4. Responsive breakpoint testing

---

## 7. LCARS design language — preserved constraints

The redesign changes information architecture and data wiring, not the visual language. These remain unchanged:
- Amber / lavender / blue / green / red palette
- Antonio headings + Share Tech Mono data
- Dark background (#000)
- Elbow bars and rounded panels
- Scanline overlay
- Single HTML file (CSS + JS inline)

---

## 8. Resolved decisions

| Question | Philipp's answer | How it's reflected |
|---|---|---|
| Stuck thresholds | "Let's try, we need to see in real usage" | Ship with proposed defaults (O'Brien: 15m/30m, Kira: 5m/15m). Tune based on observed patterns. |
| Economics panel | Keep it, wire to real token burn + human-hours data | Panel redesigned in Section 5.1. Three cost layers: AI burn, simulated human team, Philipp's actual hours. Token tracking skill needed per role. |
| Slice numbering | Implementation detail — team solves internally | Will use `slice` field in commission frontmatter. Dax/O'Brien figure out the schema. |
| Apendment visibility | Rejection always has a clear reason from Kira | Dashboard shows apendment count + reject reason. Kira's REJECTED event in register includes `reason` field. Visible on hover/tap in the pipeline. |
