# E2E Journey Catalog — Index

**Phase 1 Phase 1 scouting output.** Canonical catalog of end-to-end user journeys through the Liberation of Bajor orchestration platform.

---

## Journeys by category

### Authoring & Staging (2 journeys)

| ID | Title | Status | Sources |
|---|---|---|---|
| **J-stage-and-watch-slice** | Stage a new slice and watch it in Ops | draft | `slice-lifecycle.md`, `LIFECYCLE-NAMES-ADR.md`, `OPS-REDESIGN-SPEC-FROM-ZIYAL.md`, `new-slice.js` |
| **J-approve-and-reorder-queue** | Approve a staged slice and reorder the queue | draft | `OPS-REDESIGN-SPEC-FROM-ZIYAL.md`, `queue-lifecycle.md`, `slice-lifecycle.md` |

### Dispatch & Execution (1 journey)

| ID | Title | Status | Sources |
|---|---|---|---|
| **J-rom-completes-slice** | Rom completes a slice and transitions to code review | draft | `slice-format.md`, `slice-lifecycle.md`, `LIFECYCLE-NAMES-ADR.md`, `OPS-REDESIGN-SPEC-FROM-ZIYAL.md`, `orchestrator.js` |

### Review & Verdict (2 journeys)

| ID | Title | Status | Sources |
|---|---|---|---|
| **J-nog-accepts-slice** | Nog reviews and accepts a slice | draft | `NOG-GATE-ADR.md`, `LIFECYCLE-NAMES-ADR.md`, `slice-format.md`, `slice-lifecycle.md`, `OPS-REDESIGN-SPEC-FROM-ZIYAL.md` |
| **J-nog-rejects-slice-round-2** | Nog rejects a slice and Rom reworks it (Round 2) | draft | `NOG-GATE-ADR.md`, `LIFECYCLE-NAMES-ADR.md`, `slice-format.md`, `slice-lifecycle.md`, `OPS-REDESIGN-SPEC-FROM-ZIYAL.md` |

### Gate & Merge (2 journeys)

| ID | Title | Status | Sources |
|---|---|---|---|
| **J-merge-button-pass** | Press merge button and gate passes | draft | `BRANCHING-FOR-BASHIR-GATE-ADR.md`, `slice-format.md`, `OPS-REDESIGN-SPEC-FROM-ZIYAL.md`, `RUNBOOK-BASHIR-GATE.md`, `orchestrator.js` |
| **J-gate-fail-retry** | Gate fails, Bashir flags failed AC, user commissions hotfix and retries | draft | `BRANCHING-FOR-BASHIR-GATE-ADR.md`, `RUNBOOK-BASHIR-GATE.md`, `slice-format.md`, `OPS-REDESIGN-SPEC-FROM-ZIYAL.md` |

### Recovery (1 journey)

| ID | Title | Status | Sources |
|---|---|---|---|
| **J-recovery-mutex-orphan** | Recover from orphaned gate mutex (Bashir crash mid-gate) | draft | `BRANCHING-FOR-BASHIR-GATE-ADR.md`, `RUNBOOK-BASHIR-GATE.md`, `orchestrator.js`, `state-doctor.js` |

### Observability (2 journeys)

| ID | Title | Status | Sources |
|---|---|---|---|
| **J-watch-slice-live-log** | Watch a slice's live log while Rom is implementing | draft | `OPS-REDESIGN-SPEC-FROM-ZIYAL.md`, `orchestrator.js`, `events.jsonl` |
| **J-inspect-slice-history** | Inspect a merged slice's history and artifacts | draft | `OPS-REDESIGN-SPEC-FROM-ZIYAL.md`, `slice-format.md`, `slice-lifecycle.md`, `orchestrator.js` |

### Direct Controls (1 journey)

| ID | Title | Status | Sources |
|---|---|---|---|
| **J-direct-controls-ops-ui** | Direct controls: every Ops UI button, toggle, and interaction | draft | `OPS-REDESIGN-SPEC-FROM-ZIYAL.md`, `dashboard/server.js` |

---

## Totals

- **Categories covered:** 7 / 7 (all mandatory categories have at least 1 journey)
- **Total journeys:** 11
- **Status breakdown:**
  - draft: 11
  - reviewed: 0
  - signed-off: 0

---

## Coverage validation checklist

Per Phase 1 AC #3–#5:

- [x] **At least one journey per category:** All 7 categories represented
- [x] **User-facing effect of historical slices:** Sampled 5 DONE reports (091, 163, 208, 277, 294) — journey flows cover authoring, review, gate, recovery, observability
- [x] **Ops panels from Ziyal spec:**
  - Header: J-direct-controls-ops-ui
  - Branch Topology: J-merge-button-pass, J-gate-fail-retry, J-recovery-mutex-orphan
  - Active Build: J-rom-completes-slice, J-watch-slice-live-log
  - Pipeline: J-nog-accepts-slice, J-nog-rejects-slice-round-2
  - Queue: J-stage-and-watch-slice, J-approve-and-reorder-queue
  - History: J-inspect-slice-history
  - Direct controls inventory: J-direct-controls-ops-ui

---

## Next steps (Phase 2+)

This catalog is the spec for Phases 2–4 (infrastructure + test authoring + gate validation). Each journey's acceptance criteria become acceptance criteria for corresponding test suites. Journey open questions surface architectural ambiguities that must be resolved before test authoring begins.

See `.claude/roles/dax/inbox/RESPONSE-PHASE-1-SCOUTING-FROM-BASHIR.md` for consolidated open questions and routing.
