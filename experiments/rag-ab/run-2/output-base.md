# Register Event Catalog — `bridge/register.jsonl`

Every event shares base fields: `ts` (ISO 8601), `event` (string), and `slice_id` (string).
The table below lists additional payload fields beyond those three.

| # | Event Name | Emission Site(s) | Trigger Condition | Extra Payload Fields |
|---|---|---|---|---|
| 1 | `API_RETRY` | orchestrator.js:2465 | Anthropic API returns transient 5xx error during Rom invocation and a retry is attempted. | `retryCount`, `maxRetries`, `durationMs`, `title` |
| 2 | `ARCHIVED` | orchestrator.js:3101 | Slice file moved to archive directory after terminal completion. | `branch`, `sha`, `source` |
| 3 | `BACKFILL_ACCEPTED_COMPLETE` | orchestrator.js:5354 | Historical backfill of previously-ACCEPTED slices finishes. | `processed`, `skipped` |
| 4 | `BACKFILL_ARCHIVE_COMPLETE` | orchestrator.js:5208 | Historical backfill of archived slices finishes. | `processed`, `skipped` |
| 5 | `BACKFILL_BRANCHES_COMPLETE` | orchestrator.js:5262 | Historical backfill of git branches finishes. | `processed`, `skipped` |
| 6 | `BASHIR_TEST_NAMING_VIOLATION` | orchestrator.js:5880 | A failing gate regression test does not follow `slice-<id>-ac-<index>` naming convention. | `msg`, `dev_tip_sha` |
| 7 | `BRANCH_STATE_INITIALIZED` | state/branch-state-recovery.js:40 | Initial `branch-state.json` created on first startup. | _(none)_ |
| 8 | `BRANCH_STATE_RESET_FROM_CORRUPT` | state/branch-state-recovery.js:31 | Corrupt `branch-state.json` detected and reset to initial schema. | `corrupt_content` |
| 9 | `COMMISSIONED` | orchestrator.js:656 (via `registerCommissioned`), called at orchestrator.js:4768 | Slice picked up from queue and assigned to IN_PROGRESS. | `title`, `goal`, `body` |
| 10 | `DONE` | orchestrator.js:2299 | Rom completes work and produces a DONE report file. | `durationMs`, `tokensIn`, `tokensOut`, `costUsd` |
| 11 | `ERROR` | orchestrator.js:2011, 2215, 2239, 2326, 2502, 4733, 4997 | Slice encounters an unrecoverable error at various lifecycle phases. | `reason`, `phase`, `command`?, `exit_code`?, `stderr_tail`? |
| 12 | `ESCALATED_TO_OBRIEN` | orchestrator.js:3538 | Nog escalates a slice to O'Brien after determining ACs cannot be satisfied by Rom. | `round`, `reason` |
| 13 | `gate-abort` | orchestrator.js:5927, 5991, 6235, 6244, 6288, 6365 (via `emitGateTelemetry`) | Gate execution is aborted due to crash, timeout, user abort, missing state, or merge failure. | `dev_tip_sha`?, `reason`, `error`? |
| 14 | `gate-deferred-squash` | _(Bashir — external process)_ | A slice squash is deferred because the gate is active. Listed in gate-telemetry.js:37 VALID_EVENTS. | _(context-dependent)_ |
| 15 | `gate-drain-completed` | _(Bashir — external process)_ | Deferred slices drained after gate release. Listed in gate-telemetry.js:38 VALID_EVENTS. | _(context-dependent)_ |
| 16 | `gate-mutex-acquired` | state/gate-mutex.js:51 (via `emit`) | Gate mutex successfully acquired at gate start. | `dev_tip_sha`, `bashir_pid`, `bashir_heartbeat_path`, `started_ts` |
| 17 | `gate-mutex-orphan-recovered` | state/gate-mutex.js:204 (via `emit`) | Orphaned gate mutex detected and recovered during startup. | `recovery_signal`, `held_duration_ms`, `last_heartbeat_age_ms` |
| 18 | `gate-mutex-released` | state/gate-mutex.js:81 (via `emit`) | Gate mutex released after regression pass, fail, or abort. | `reason`, `held_duration_ms` |
| 19 | `gate-start` | orchestrator.js:5602 (via `emitGateTelemetry`) | Gate execution begins (Bashir regression gate spawned). | `devTipSha`, `ts` |
| 20 | `gate-state-reinitialized` | _(Bashir — external process)_ | Gate state reset from corrupt or stale condition. Listed in gate-telemetry.js:40 VALID_EVENTS. | _(context-dependent)_ |
| 21 | `gate-state-transition` | _(Bashir — external process)_ | Gate state transitions between phases. Listed in gate-telemetry.js:39 VALID_EVENTS. | _(context-dependent)_ |
| 22 | `LEGACY_FILES_DETECTED` | orchestrator.js:5378 | Non-canonical queue files found during startup audit. | `count`, `sample` |
| 23 | `lock-cycle` | orchestrator.js:1376, 1395, 2826, 2922, 6263, 6373 (via `emitGateTelemetry`) | Filesystem lock/unlock cycle completes during merge operations. | `cycle_phase`, `triggering_op`, `held_duration_ms` |
| 24 | `LOCK_CLAIMED` | git-finalizer.js:353 | Git lock claimed at start of a serialized git operation. | `op`, `cmd` |
| 25 | `LOCK_ORPHAN_PRUNED` | git-finalizer.js:181, 459 | Orphaned `.git/index.lock` pruned (process dead or lock too old). | `op`?, `artifact`, `lock_mtime`?, `lock_age_s`?, `phase`? |
| 26 | `LOCK_RELEASED` | git-finalizer.js:357 | Git lock released after successful git operation. | `op` |
| 27 | `MAIN_PUSHED_TO_ORIGIN` | orchestrator.js:1384 | Local main branch pushed to origin after a dev-to-main merge. | `sha`, `ahead_count` |
| 28 | `MAX_ROUNDS_EXHAUSTED` | orchestrator.js:3309 | Rom completes maximum rounds (5) without Nog sign-off — slice stuck. | `round`, `reason` |
| 29 | `merge-complete` | orchestrator.js:6341 (via `emitGateTelemetry`) | Gate merge completes — all queued slices merged from dev to main. | `merge_sha`, `slices`, `dev_fast_forwarded_to` |
| 30 | `MERGED` | orchestrator.js:3150, 4949 | Slice successfully squash-merged to dev branch. | `branch`, `sha`, `recovery`? |
| 31 | `MERGE_FAILED` | orchestrator.js:3162, 4953 | Slice squash-merge to dev fails. | `branch`, `reason`, `recovery`? |
| 32 | `MERGE_INTEGRITY_VIOLATION` | orchestrator.js:2845 | Post-merge git integrity assertion fails (expected != actual SHA). | `expected_sha`, `actual_sha`, `reason` |
| 33 | `MERGE_NOT_PUSHED` | orchestrator.js:2902 | Git push succeeds locally but origin tip does not advance. | `local_sha`, `origin_sha`, `reason` |
| 34 | `NOG_DECISION` | orchestrator.js:3126, 3492, 3666, 4561 | Nog renders a verdict on a slice (ACCEPTED, REJECTED, or auto-accepted). | `verdict`, `reason`, `cycle`?, `round`, `apendment_cycle`? |
| 35 | `NOG_ESCALATION` | orchestrator.js:3306 | Rom requests escalation after max rounds exhausted or escalate verdict. | `round`, `branch` |
| 36 | `NOG_INVOKED` | orchestrator.js:4612 | Nog invited to review a completed DONE report. | `round` |
| 37 | `NOG_TELEMETRY` | orchestrator.js:3631 (via `emitGateTelemetry`) | Nog verdict emits telemetry about review complexity metrics. | `slice_id`, `rounds`, `files_touched`, `high_risk_surface`, `lint_findings_total`, `ac_count`, `escalated` |
| 38 | `RATE_LIMITED` | orchestrator.js:2409 | Claude API rate limit hit; slice requeued for retry. | `waitMs`, `resetAt`, `durationMs`, `title` |
| 39 | `REFS_LOCK_DETECTED` | git-finalizer.js:286, 297 | Refs lock (`.git/refs/heads/**.lock` or `.git/packed-refs.lock`) found but not pruned. | `lock_path`, `lock_age_s`, `decline_reason` |
| 40 | `REFS_LOCK_ORPHAN_PRUNED` | git-finalizer.js:310 | Orphaned refs lock safely pruned. | `lock_path`, `lock_age_s`, `lock_mtime` |
| 41 | `regression-fail` | orchestrator.js:5837, 5886 (via `emitGateTelemetry`) | Gate regression tests fail or time out. | `failed_acs`, `reason`? |
| 42 | `regression-pass` | orchestrator.js:5854 (via `emitGateTelemetry`) | Gate regression tests pass. | `suite_size`, `duration_ms` |
| 43 | `RENAME_FAILED` | orchestrator.js:2959, 2974 | Failed to rename DONE/IN_REVIEW file to ACCEPTED. | `src`, `dst`, `error` |
| 44 | `RESTAGED` | new-slice.js:385 | Previously-commissioned slice re-staged for retry. | _(none)_ |
| 45 | `RETURN_TO_STAGE` | orchestrator.js:4068, 4077, 4097 | Error slice manually returned to STAGED for rework. | `from_event`, `reason`, `body_source` |
| 46 | `ROM_ABORTED` | orchestrator.js:4330 | Rom subprocess manually aborted; slice returned to STAGED. | `round`, `reason` |
| 47 | `ROM_ESCALATE` | orchestrator.js:4576 | Rom escalates slice via "## Rom Escalation — Slice Broken" fast path. | `reason` |
| 48 | `ROM_PAUSED` | orchestrator.js:4228 | Rom subprocess paused via control command. | `round` |
| 49 | `ROM_RESUMED` | orchestrator.js:4261 | Rom subprocess resumed after pause. | `round` |
| 50 | `ROM_SESSION_FRESH` | orchestrator.js:2112, 2121 | Rom invoked with a fresh session (not resuming prior). | `session_id`, `round`, `reason_for_fresh` |
| 51 | `ROM_SESSION_RESUMED` | orchestrator.js:2117 | Rom resumes a prior session for a rework round. | `session_id`, `round`, `reason_for_fresh` |
| 52 | `SLICE_DEFERRED` | orchestrator.js:2998 | Slice merge deferred because gate is currently running. | `reason` |
| 53 | `SLICE_MERGED_TO_MAIN` | orchestrator.js:6334 | Individual slice merged to main during gate merge phase. | `merge_sha` |
| 54 | `SLICE_SQUASHED_TO_DEV` | orchestrator.js:6093 | Slice squash-merged to dev during gate execution. | `dev_tip_sha`, `squash_sha` |
| 55 | `STALE_LOCK_DETECTED` | git-finalizer.js:470 | `.git/index.lock` exists but conditions prevent safe pruning. | `heartbeat_status`, `last_activity_ts`, `activity_age_s`, `decline_reason` |
| 56 | `STATE_FILES_ARCHIVED` | orchestrator.js:3051 | Terminal state files moved from queue to trash during archival. | `terminal_state`, `moved` |
| 57 | `tests-updated` | _(Bashir — external process)_ | Bashir finishes writing/updating regression test files. Read back at orchestrator.js:5644. Listed in gate-telemetry.js:44 VALID_EVENTS. | _(context-dependent)_ |
| 58 | `WORKTREE_CREATED` | orchestrator.js:1533 | Git worktree created for a slice. | `path`, `branch` |
| 59 | `WORKTREE_ORPHAN_PRUNED` | git-finalizer.js:368, 534 | Orphaned worktree directory pruned at startup or after failed create. | `op`?, `artifact`, `phase`?, `dir_mtime`? |
| 60 | `WORKTREE_REMOVED` | orchestrator.js:1584 | Worktree cleaned up after slice completion. | `path` |
| 61 | `WORKTREE_SETUP_RETRY` | git-finalizer.js:598 | Worktree creation retried due to index.lock contention. | `attempt`, `max_retries`, `backoff_ms`, `error` |

**Total unique event names: 61**

---

## Emission Channels

Events reach `register.jsonl` through two channels:

1. **`registerEvent(id, event, extra)`** — defined at orchestrator.js:626. Writes `{ ts, slice_id, event, ...extra }`. Used by orchestrator.js, git-finalizer.js, state/branch-state-recovery.js, and new-slice.js. Special variant `registerCommissioned()` at orchestrator.js:656 adds retry logic.

2. **`emit(eventName, fields)`** — defined at state/gate-telemetry.js:66. Writes `{ ts, event, ...fields }` (no `slice_id` in base). Validates against `VALID_EVENTS` allowlist. Used by state/gate-mutex.js directly and by orchestrator.js via the `emitGateTelemetry` wrapper.

3. **External (Bashir)** — The Bashir subprocess (`claude -p`) writes directly to `register.jsonl`. Events `tests-updated`, `gate-deferred-squash`, `gate-drain-completed`, `gate-state-transition`, and `gate-state-reinitialized` are in the `VALID_EVENTS` allowlist but have no emission site in this codebase.

## Files Scanned

- `bridge/orchestrator.js` — 46 emission sites
- `bridge/git-finalizer.js` — 8 emission sites
- `bridge/state/gate-mutex.js` — 3 emission sites (via gate-telemetry `emit`)
- `bridge/state/gate-telemetry.js` — emission channel definition + VALID_EVENTS allowlist
- `bridge/state/branch-state-recovery.js` — 2 emission sites
- `bridge/state/gate-alerts.js` — no emissions
- `bridge/state/atomic-write.js` — no emissions
- `bridge/state/initial-schema.js` — no emissions
- `bridge/new-slice.js` — 1 emission site
- `bridge/lifecycle-translate.js` — reads only, no emissions
- `bridge/rr-compute.js` — reads only, no emissions
- `bridge/state-doctor.js` — reads only, no emissions
- `bridge/scripts/backfill-register.js` — writes synthetic DONE events (same shape as #10)
