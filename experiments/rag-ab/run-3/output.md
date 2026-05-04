# Slice Lifecycle Summary — Liberation of Bajor

## Lifecycle States

A slice is a single-file Kanban ticket. The filename suffix **is** the status. Eight states, strict ordering:

| # | State | Owner | Exit trigger |
|---|-------|-------|-------------|
| 1 | **STAGED** | O'Brien | Drafts slice file |
| 2 | **QUEUED** | Server | Philipp clicks Approve in Ops Center |
| 3 | **IN_PROGRESS** | Watcher | Picks up PENDING, creates worktree, spawns Rom |
| 4 | **DONE** | Rom | Writes completion report |
| 5 | **IN_REVIEW** | Watcher | Hands slice to Nog |
| 6 | **ACCEPTED** | Nog | ACs met, goal achieved |
| 7 | **MERGED** | Watcher | `git merge --no-ff` + push to origin |
| 8 | **ARCHIVED** | Watcher | Terminal state. Worktree pruned, branch deleted |

**Rejection loop:** Nog rejects -> slice returns to QUEUED (up to 5 rounds). After 5 failures, escalates to O'Brien, who reworks and returns it to STAGED.

## State Files (`bridge/state/`)

| File | Purpose |
|------|---------|
| `branch-state.json` | Tracks main tip, dev tip, commits ahead, deferred slices, gate status (IDLE/running) |
| `initial-schema.js` | Factory for fresh `branch-state.json` (schema v1) |
| `branch-state-recovery.js` | Startup reconciliation: re-derives branch state from git, emits BRANCH_STATE_INITIALIZED |
| `atomic-write.js` | Safe JSON writes via temp+rename (no partial writes) |
| `gate-mutex.js` | Prevents concurrent gate runs; owns `gate-running.json` lock file |
| `gate-telemetry.js` | Single owner of all gate metric emission via `emit()` -> `registerEvent()` |
| `gate-alerts.js` | Pure functions evaluating register tail + gate state, returning structured alerts |

## Register Events (top 10 by emit-site frequency)

`registerEvent()` in `bridge/orchestrator.js` is the **sole writer** to `register.jsonl`. Events ordered by number of distinct call sites in code:

| Event | Call sites | Context |
|-------|-----------|---------|
| `ERROR` | 5 | Rom crash, API failure, timeout, spawn failure, unknown |
| `NOG_DECISION` | 4 | ACCEPTED (x2), REJECTED (x2 — unreadable + findings) |
| `RETURN_TO_STAGE` | 3 | Manual, recovered body, escalation rework |
| `ROM_SESSION_FRESH` | 3 | New session, resumed session, no-session-id fallback |
| `LOCK_ORPHAN_PRUNED` | 2 | git-finalizer cleans stale lock files |
| `REFS_LOCK_DETECTED` | 2 | git ref-lock collision detection |
| `WORKTREE_ORPHAN_PRUNED` | 2 | Stale worktree cleanup |
| `RENAME_FAILED` | 2 | Slice file rename failure during state transition |
| `DONE` | 1 | Rom completion (duration, tokens, cost) |
| `MERGED` | 1 | Successful merge to main (branch, sha) |

Additional events (1 site each): `WORKTREE_CREATED`, `WORKTREE_REMOVED`, `MAIN_PUSHED_TO_ORIGIN`, `ROM_SESSION_RESUMED`, `RATE_LIMITED`, `API_RETRY`, `MERGE_INTEGRITY_VIOLATION`, `MERGE_NOT_PUSHED`, `SLICE_DEFERRED`, `STATE_FILES_ARCHIVED`, `ARCHIVED`, `MERGE_FAILED`, `NOG_ESCALATION`, `MAX_ROUNDS_EXHAUSTED`, `ESCALATED_TO_OBRIEN`, `ROM_PAUSED`, `ROM_RESUMED`, `ROM_ABORTED`, `ROM_ESCALATE`.

## Key Invariants

- One file per slice, one location at a time. No parallel lifecycles.
- Merge strictly after ACCEPTED. Archive strictly after MERGED.
- Each actor only moves the ticket out of the state they own.
- Slice file is append-only after leaving STAGED (Nog appends verdicts, never edits).
- Rejection does not lose work — the slice branch survives the loop.
- Escalation to O'Brien is automatic after 5 failed Nog rounds.

---

*Generated 2026-05-04 from codebase analysis of `docs/contracts/slice-lifecycle.md`, `bridge/state/*`, and `bridge/orchestrator.js`.*
