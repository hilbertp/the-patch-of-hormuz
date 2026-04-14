# Sprint 3 — Close the Autonomy Loop

**Owner:** Philipp | **Updated:** 2026-04-14 | **Status:** Locked — ready to start

**Visual roadmap (Sprints 3–5):** `sprint-roadmap.html`
**Ruflo benchmark protocol:** `benchmark-kira-obrien-vs-ruflo.md`

---

## Bet

After Philipp approves slices, the pipeline executes, reviews, and recovers without Philipp until Kira delivers a demo or escalates a terminal problem.

---

## Scope

| Feature | Why | Notes |
|---------|-----|-------|
| **Wormhole** | Cowork writes to macOS filesystem triggered permission prompts on every operation. Wormhole is a native macOS MCP server — Cowork calls its tools instead of writing through VirtioFS. No prompts. | ADR accepted. POC live. O'Brien builds: MCP server core + writer-split migration (not on critical path — drain ships first). |
| **Kira drain** | Kira is passive — Philipp has to nudge her on every error or escalation. Drain is a Cowork scheduled task (every 10 min) that checks `bridge/kira-events.jsonl` for STUCK/ERROR/ALL_COMPLETE events and decides autonomously. | ADR accepted. Depends on Wormhole server shipping first. Context from KIRA.md via `/wrap-up` discipline. |
| **Nog** | Rename Anon → Nog. Kira writes the role spec from scratch. Adds: kanban history per slice (what was tried, assessment, delta to ACs), explicit `i < 6` counter, escalate to Kira at max. | Kira writes spec, O'Brien implements. Not an Anon diagnosis — a clean role definition. |
| **Error reporting** | Ops Center shows *why* something failed, not just "error" state. | Capture + surface in Ops Center. No auto-retry — Sprint 4. |
| **Ops Center (Ziyal's design)** | Without it, Sprint 3 pipeline improvements are invisible and the demo doesn't land. | Full spec — all 6 screens. Reference: `ops-dashboard-spec.md` + `ops-ux-concept.html`. Nog live / Bashir "coming soon" handled at build time. |
| **Invocation gap indicator** | After Philipp approves a slice there are 3–5 seconds before O'Brien produces output — the panel shows nothing happening. A transient "Invoking O'Brien — waiting for first response…" label bridges this gap. | Full spec in `ops-dashboard-spec.md` addendum 2026-04-14. Disappears the moment O'Brien's first output arrives. |

---

## Architecture resolved

Both Sprint 3 blockers have accepted ADRs:

- `docs/architecture/KIRA-ACTIVATION-ADR.md` — Kira drain design
- `docs/architecture/WORMHOLE-ADR.md` — permissionless filesystem bridge

---

## Open (non-blocking)

**Headless consent behavior:** Does consent granted in an interactive Cowork session carry to a headless scheduled task? Dax tests live during Kira activation wiring. If it doesn't, a consent preflight mechanism is built then. Decision deferred until test result is known — don't plan for it now.

---

## Keeps as-is

Philipp approves staged slices. FIFO queue. Files as source of truth.

---

## Ruflo benchmark

Runs in parallel. Cut `ruflo-benchmark-baseline` branch before sprint starts.

---

## Assessment

1. Did Kira deliver a demo?
2. Did Philipp stay in the Ops Center?
