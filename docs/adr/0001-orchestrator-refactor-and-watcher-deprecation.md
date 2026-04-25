# ADR 0001: Orchestrator Modularisation, Watcher Consolidation, and PARKED Elimination

**Status:** Proposed  
**Author:** Rom (Implementor) — slice 192  
**Date:** 2026-04-23  
**Implements:** Slices 193–195  
**Supersedes:** None (first ADR in docs/adr/)

---

## Executive Summary

`bridge/orchestrator.js` has grown to 4,716 lines carrying 24 named concerns in a single flat file — config, git operations, subprocess invocation, state-machine transitions, crash recovery, telemetry, rate-limiting, and more. The file is too large to reason about safely and was the locus of two production incidents (slices 186, 187) where require-cache staleness caused dropped state during manual rescue operations.

This ADR defines three cuts. **Slice 193** deletes dead code already marked deprecated in the file (the FUSE-safe checkout functions, ~180 LOC removed). **Slice 194** splits `orchestrator.js` into 8 modules under `bridge/relay/`, each under 600 LOC — a pure refactor with zero behavior change. **Slice 195** eliminates the PARKED intermediate file by embedding the original slice spec in the DONE report (Path A), simplifying the state machine from 7 file-states to 6.

The historical `watcher.js` was renamed to `orchestrator.js` in slice 176; there is no separate watcher file to delete. Watcher "deprecation" means ensuring the new `relay/index.js` entry point fully replaces the current `orchestrator.js` startup block.

---

## 1. Survey: Current Responsibilities in orchestrator.js

`bridge/orchestrator.js` at 4,716 LOC contains 24 named concerns:

| # | Concern | Approx LOC | Entry point |
|---|---|---|---|
| 1 | Config loading + path resolution | ~85 | L12 |
| 2 | Activity tracking + rate-limit state | ~60 | L79 |
| 3 | Terminal presentation + ANSI/NO_COLOR | ~70 | L141 |
| 4 | Token/cost extraction | ~95 | L213 |
| 5 | Session state tracking | ~55 | L307 |
| 6 | Queue snapshot (`getQueueSnapshot`) | ~25 | L337 |
| 7 | Startup directory creation + lifecycle blocks | ~120 | L361 |
| 8 | Structured logging to `bridge.log` | ~50 | L485 |
| 9 | Register / event log (`registerEvent`, `registerCommissioned`) | ~80 | L505 |
| 10 | Frontmatter parsing + mutation | ~175 | L584 |
| 11 | FUSE-safe checkout (deprecated) | ~257 | L760 |
| 12 | Worktree management (create/cleanup/verify) | ~368 | L1268 |
| 13 | Heartbeat writer | ~47 | L1637 |
| 14 | Active child tracking + processing flag | ~15 | L1684 |
| 15 | Rom invocation (spawn, inactivity, DONE validation) | ~576 | L1699 |
| 16 | Evaluator invocation | ~660 | L2276 |
| 17 | Nog code-review invocation | ~597 | L2937 |
| 18 | ERROR file writing | ~120 | L3535 |
| 19 | Control file processing (return-to-stage) | ~110 | L3655 |
| 20 | Pause / Resume / Abort signal handling | ~270 | L3766 |
| 21 | Poll cycle (dispatch loop) | ~312 | L4037 |
| 22 | Crash recovery on startup | ~174 | L4350 |
| 23 | Slice ID management (`nextSliceId`) | ~34 | L4525 |
| 24 | Graceful shutdown + RESTAGED bootstrap + startup entry | ~90 | L4560 |

### watcher.js: already consolidated

`watcher.js` was renamed to `orchestrator.js` via `git mv` in slice 176. No separate `watcher.js` file exists in the codebase. The string "Watcher started" at L4649 is a log message from the startup block, not a module boundary. The watcher deprecation goal means: the new `bridge/relay/index.js` replaces the current `orchestrator.js` startup block (L4644–4712), so `orchestrator.js` becomes a thin shim requiring `./relay/index.js`. The watcher, as a concept, is fully absorbed into the relay.

---

## 2. Proposed Module Boundaries

Target layout: `bridge/relay/`. All modules target ≤600 LOC. Two currently-dead code sections (FUSE-safe checkout, L760–1267) are deleted in slice 193 before the split, reducing the total mass.

| Module | Drawn from (post-193) | Concerns | Est. LOC |
|---|---|---|---|
| `relay/config.js` | L12–85 | Config loading, path constants, defaults | ~85 |
| `relay/register.js` | L485–759 | Structured logging, event log (`registerEvent`, `registerCommissioned`), frontmatter parsing/mutation | ~305 |
| `relay/git.js` | L1268–1636 (post-193) | Worktree create/cleanup/verify, branch creation, merge to main, stale-lock sweep | ~370 |
| `relay/telemetry.js` | L79–140, L213–360, L1637–1683 | Rate-limit state, activity tracking, token/cost, session state, heartbeat | ~275 |
| `relay/subprocess.js` | Shared helpers from L1699–3534 | Spawn, signal helpers (SIGSTOP/SIGCONT/SIGTERM), inactivity-kill pattern, stdout/stderr capture | ~300 |
| `relay/invoke-rom.js` | L1699–2275 (minus shared helpers) | Rom-specific invocation: prompt construction, DONE validation, spec embedding (Path A) | ~450 |
| `relay/invoke-nog.js` | L2276–3534 (minus shared helpers) | Evaluator + Nog invocation, verdict parsing, amendment writer | ~550 |
| `relay/control.js` | L3535–4036 | ERROR file writing, control-file processing, pause/resume/abort, return-to-stage | ~500 |
| `relay/recovery.js` | L4350–4643 | Crash sweep, dead-worktree cleanup, RESTAGED bootstrap, `nextSliceId` | ~270 |
| `relay/dispatch.js` | L4037–4349 | Poll loop, priority sort, slice picker, rate-limit gate reads | ~312 |
| `relay/lifecycle.js` | L361–503 | Startup directory setup, lifecycle blocks, state-name constants | ~120 |
| `relay/index.js` | L4644–4712 + exports | Entry point, module wiring, graceful shutdown, re-exports (`nextSliceId`, etc.) | ~130 |

`bridge/orchestrator.js` is replaced by a three-line shim: `module.exports = require('./relay/index.js')`. This preserves backward-compat for `bridge/new-slice.js:27` which does `require('./orchestrator.js')` to get `nextSliceId`.

---

## 3. Watcher Deprecation Path

**Already executed (slice 176):** `git mv bridge/watcher.js bridge/orchestrator.js`. No watcher.js exists.

**Remaining action in slice 193:** Delete the FUSE-safe checkout functions that the file itself marks deprecated:
- `fuseSafeCheckoutMain` (L843–925): comment "DEPRECATED—worktree model obsoletes this"
- `fuseSafeCheckoutBranch` (L945–1017): same deprecation

These functions are dead code — the worktree model replaced them. Deleting them in slice 193 before the slice-194 split keeps the git.js module clean and under the LOC target.

**Entry point consolidation (slice 194):** `bridge/orchestrator.js` becomes:
```js
'use strict';
module.exports = require('./relay/index.js');
```
`bridge/relay/index.js` contains the full startup block. `node bridge/orchestrator.js` continues to work. `node bridge/relay/index.js` also works.

**Caller audit:** `bridge/new-slice.js:27` is the only non-startup consumer of `orchestrator.js` exports. It imports `nextSliceId`. After slice 194, `relay/index.js` re-exports `nextSliceId`, and the shim in `orchestrator.js` forwards it transparently — no change required in `new-slice.js`.

---

## 4. PARKED Elimination — Decision: Path A (DONE-only)

**Decision: Path A.** Rom embeds the original slice specification in the DONE report. Nog reads from the DONE/EVALUATING file directly. The PARKED file is never created.

### What changes

| Component | Current behavior (line) | Path A behavior |
|---|---|---|
| `orchestrator.js` L2211 | Rename IN_PROGRESS → PARKED on Rom completion | Remove: no PARKED rename; state goes IN_PROGRESS → (Rom writes DONE) |
| `orchestrator.js` L4122–4128 | Poll loop checks for PARKED companion before dispatching DONE to Nog | Remove: DONE files always eligible for Nog pickup |
| `orchestrator.js` L2421–2428 | `invokeNog()` reads PARKED file for original ACs | Update: read `## Original Specification` section from DONE/EVALUATING file |
| Rom prompt | Writes DONE with execution results only | Writes DONE with a `## Original Specification` section containing the verbatim slice body |
| `lifecycle-translate.js` | `translateState`: maps PARKED → IN_REVIEW | Remove PARKED mapping (state no longer produced) |
| `new-slice.js` | No change needed | No change |

### Why Path A

- **Fewest state files.** One file per slice at any point during evaluation. Recovery: an orphaned DONE contains everything needed. No companion-file hunting.
- **Consistent with register.** `registerCommissioned` (L564–581) already embeds the full slice body in `register.jsonl` for the same reason — the spec must always be recoverable without file hunting. Path A extends this principle to the DONE file.
- **Simpler state machine.** IN_PROGRESS → DONE → EVALUATING → ACCEPTED. PARKED was an intermediate hold with no distinct behavior — the poll loop at L4122–4128 just used it as a gate, not as a signal for any action.
- **Crash recovery simplifies.** Currently crash recovery must handle orphaned PARKED files (rename back to IN_PROGRESS for re-processing). Under Path A, only DONE/EVALUATING need crash-recovery treatment — same as today minus the PARKED case.

### Alternatives considered

**Path B (single accumulating file):** The slice file itself mutates in place — STAGED → IN_PROGRESS → DONE with appended sections for each round. Rejected: requires the orchestrator to write to the same file across multiple role invocations and rounds. This creates multi-writer lock risk and breaks the invariant that a file's suffix encodes its current state.

**Path C (read spec from git):** Nog reads the original spec from the first commit on the slice branch. Rejected: adds a mandatory git operation on every Nog evaluation, couples the hot path to git history traversal, and fails if the branch is rebased or the worktree is absent. The spec is not primary information for git — it is primary information for the evaluation chain.

---

## 5. Backwards Compatibility and Rollout

### In-flight slices during relay deploy (slice 194)

The transition is a process restart. The orchestrator process restarts; the file queue is unchanged on disk.

- **Slice in IN_PROGRESS:** child process is already running. On restart, crash-recovery (L4367–4450) detects the orphaned IN_PROGRESS and re-queues it. The new relay re-invokes Rom. Identical to existing crash-recovery behavior.
- **Slice in DONE awaiting Nog:** DONE file remains on disk. New relay picks it up on first poll cycle.
- **Slice in EVALUATING:** crash-recovery renames to DONE for re-evaluation. Same as today.

No data migration required for slice 193 or 194. The file queue format is unchanged.

### PARKED migration (slice 195)

Pre-deploy checklist:
1. Confirm `ls bridge/queue/*-PARKED.md` returns empty. If any PARKED files exist, manually rename to the companion DONE filename — they represent completed Rom work awaiting Nog and are safe to re-expose as plain DONE.
2. Deploy slice 195.
3. New DONE reports include `## Original Specification`. Nog prompt updated to read from that section.
4. lifecycle-translate.js PARKED mapping removed.

### Rollback

Each slice lands on its own branch. Rollback = revert the merge commit on main.

- **Slice 193 rollback:** Restore deleted FUSE-safe checkout functions. No data impact.
- **Slice 194 rollback:** Restore `bridge/orchestrator.js` (full 4716-line version), delete `bridge/relay/`. No data impact.
- **Slice 195 rollback:** Restore PARKED creation logic. No data loss — DONE files generated under Path A contain the original spec and the Rom report; re-adding PARKED logic would just skip re-creating the PARKED companion for those slices (they re-evaluate cleanly from DONE).

---

## 6. Follow-on Slice Sequence

| Slice | Goal | Files touched | Est. net LOC diff |
|---|---|---|---|
| **193** | Delete dead FUSE-safe checkout code (`fuseSafeCheckoutMain` L843–925, `fuseSafeCheckoutBranch` L945–1017) and any other DEPRECATED-marked blocks. Confirm tests pass. | `bridge/orchestrator.js` only | −180 LOC |
| **194** | Split orchestrator.js into `bridge/relay/` modules per §2. `orchestrator.js` becomes 3-line shim. `new-slice.js` require path tested (no change needed, shim preserves export). | New: `bridge/relay/*.js` (12 files); Modified: `bridge/orchestrator.js` (shim) | ~−4350 / +3670 gross; net: −680 LOC (dead paths not re-introduced) |
| **195** | Eliminate PARKED per Path A. Remove PARKED rename (L2211), remove PARKED poll gate (L4122–4128), update invokeNog to read spec from DONE, update Rom prompt to embed spec, update lifecycle-translate.js, update Nog prompt. | `bridge/relay/invoke-rom.js`, `relay/invoke-nog.js`, `relay/dispatch.js`, `bridge/lifecycle-translate.js`, Nog prompt template | ~300 LOC changed |

No slice exceeds 600 LOC of net diff. Slice 194 moves large amounts of code but introduces zero behavior change — it is a mechanical extraction with module-boundary naming as the only intellectual content.

---

## 7. Evidence Citations

All citations are verifiable in `bridge/orchestrator.js` on `main` at the time of this ADR:

1. **PARKED file creation** — `L2211`: `const parkedPath = path.join(QUEUE_DIR, \`${id}-PARKED.md\`)`
2. **PARKED poll gate** — `L4122–4128`: poll loop checks for PARKED companion before dispatching DONE to Nog
3. **Nog reads PARKED for ACs** — `L2421–2428`: `invokeNog()` reads PARKED file, not DONE, for original success criteria
4. **Deprecated FUSE-safe checkout** — `L843`: inline comment "DEPRECATED—worktree model obsoletes this"
5. **nextSliceId export** — `L4716`: `module.exports = { nextSliceId, getQueueSnapshot, ... }`
6. **Register sole writer** — `L534`: `function registerEvent(id, event, extra)` — single write path for `register.jsonl`
7. **registerCommissioned embeds spec** — `L564–581`: full slice body embedded in COMMISSIONED event (precedent for Path A)
8. **Poll loop entry** — `L4040`: `function poll()`
9. **Crash recovery entry** — `L4367`: `function crashRecovery()`
10. **Rom subprocess spawn** — `L1845–1856`: `execFile(config.claudeCommand, config.claudeArgs, {cwd: worktreePath}, callback)`
