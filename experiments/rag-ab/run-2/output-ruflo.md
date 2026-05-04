# Register Event Catalog — `bridge/register.jsonl`

Every event shares base fields: `ts` (ISO 8601), `event` (string), and `slice_id` (string).
The table below lists additional payload fields beyond those three.

## Writer A: `registerEvent()` (orchestrator.js:626)

Synchronous append via `fs.appendFileSync`. Sole writer for pipeline events. Includes write-time dedupe for MERGED on `(slice_id, sha)`.

## Writer B: `emit()` (state/gate-telemetry.js:66)

Gate-specific telemetry writer. Validates event name against `VALID_EVENTS` set before writing. Entry has `event` and `ts` but no automatic `slice_id`.

## Writer C: Direct `fs.appendFileSync` (new-slice.js:386, orchestrator.js:5131)

Bootstrap and restage paths that write RESTAGED events directly.

## Writer D: `registerCommissioned()` (orchestrator.js:656)

Dedicated COMMISSIONED writer with one retry on failure.

---

| # | Event Name | Emission Site(s) | Trigger Condition | Extra Payload Fields |
|---|---|---|---|---|
| 1 | `API_RETRY` | orchestrator.js:2465 | Rom invocation fails with transient error and is retried. | `retryCount`, `maxRetries`, `durationMs`, `title` |
| 2 | `ARCHIVED` | orchestrator.js:3101 | Slice is archived (moved out of active queue after terminal completion). | `branch`, `sha`, `source` |
| 3 | `BACKFILL_ACCEPTED_COMPLETE` | orchestrator.js:5354 | One-shot backfill of previously-ACCEPTED slices finishes. | `processed`, `skipped` |
| 4 | `BACKFILL_BRANCHES_COMPLETE` | orchestrator.js:5262 | One-shot cleanup of stale local slice branches finishes. | `processed`, `skipped` |
| 5 | `BASHIR_TEST_NAMING_VIOLATION` | orchestrator.js:5880 | A failing test file doesn't match the `slice-<id>-ac-<index>` naming convention. | `msg`, `dev_tip_sha` |
| 6 | `BRANCH_STATE_INITIALIZED` | state/branch-state-recovery.js:40 | branch-state.json is created for the first time. | _(none)_ |
| 7 | `BRANCH_STATE_RESET_FROM_CORRUPT` | state/branch-state-recovery.js:31 | branch-state.json is corrupt/unparseable and is reset to clean state. | `corrupt_content` |
| 8 | `COMMISSIONED` | orchestrator.js:658 (via `registerCommissioned` at :4768) | A new slice is commissioned into the pipeline. | `title`, `goal`, `body` |
| 9 | `DONE` | orchestrator.js:2299 | Rom completes successfully with valid metrics. | `durationMs`, `tokensIn`, `tokensOut`, `costUsd` |
| 10 | `ERROR` | orchestrator.js:2011, :2215, :2239, :2326, :2502, :4733, :4997 | Slice encounters an error during worktree setup, Rom invocation, verification, validation, or paused-child-died recovery. | `reason`, `phase`, `command` (optional), `exit_code` (optional), `stderr_tail` (optional), `invalid` (optional), `durationMs` (optional), `rescue_path` (optional), `missingFields` (optional) |
| 11 | `ESCALATED_TO_OBRIEN` | orchestrator.js:3538 | Nog escalates to O'Brien due to unsatisfiable acceptance criteria. | `round`, `reason` |
| 12 | `LEGACY_FILES_DETECTED` | orchestrator.js:5378 | Audit detects non-canonical queue file names in bridge/queue/. | `count`, `sample` |
| 13 | `LOCK_CLAIMED` | git-finalizer.js:353 | Git-finalizer acquires the in-process serialisation lock before a git command. | `op`, `cmd` |
| 14 | `LOCK_ORPHAN_PRUNED` | git-finalizer.js:181, :459 | An orphaned `.git/index.lock` is detected (owner dead) and safely removed. | `op`, `artifact`, `lock_mtime`, `lock_age_s`, `phase` (optional) |
| 15 | `LOCK_RELEASED` | git-finalizer.js:357 | Git-finalizer releases the in-process lock after a git command completes. | `op` |
| 16 | `MAIN_PUSHED_TO_ORIGIN` | orchestrator.js:1384 | Main branch is successfully pushed to origin after a dev-to-main merge. | `sha`, `ahead_count` |
| 17 | `MAX_ROUNDS_EXHAUSTED` | orchestrator.js:3309 | Slice reaches the maximum Nog evaluation rounds (5) without approval. | `round`, `reason` |
| 18 | `MERGE_FAILED` | orchestrator.js:3162, :4953 | Merge attempt (squash-to-dev) fails; recovery variant also exists. | `branch`, `reason`, `recovery` (optional, boolean) |
| 19 | `MERGE_INTEGRITY_VIOLATION` | orchestrator.js:2845 | Post-merge integrity assertion fails (expected SHA != actual SHA on dev tip). | `expected_sha`, `actual_sha`, `reason` |
| 20 | `MERGE_NOT_PUSHED` | orchestrator.js:2902 | Merge cannot be pushed due to a state violation. | _(variable — depends on violation)_ |
| 21 | `MERGED` | orchestrator.js:3150, :4949 | Slice successfully squash-merges to dev; recovery variant also exists. | `branch`, `sha`, `recovery` (optional, boolean) |
| 22 | `NOG_DECISION` | orchestrator.js:3126, :3492, :3666, :4561 | Nog evaluator returns ACCEPTED or REJECTED verdict for a slice. | `verdict`, `reason`, `cycle`, `round`, `apendment_cycle` (optional) |
| 23 | `NOG_ESCALATION` | orchestrator.js:3306 | Nog escalates a slice after exhausting evaluation attempts. | `round`, `branch` |
| 24 | `NOG_INVOKED` | orchestrator.js:4612 | Nog evaluator is invoked to review a slice. | `round` |
| 25 | `NOG_TELEMETRY` | orchestrator.js:3631 (via `emitGateTelemetry`) | Nog evaluation completes; summary metrics are emitted as a side-effect. | `slice_id`, `rounds`, `files_touched`, `high_risk_surface`, `lint_findings_total`, `ac_count`, `escalated` |
| 26 | `RATE_LIMITED` | orchestrator.js:2409 | Claude API rate limit (429) is hit during Rom invocation. | `waitMs`, `resetAt`, `durationMs`, `title` |
| 27 | `REFS_LOCK_DETECTED` | git-finalizer.js:286, :297 | A `.git/refs/**/*.lock` or `.git/packed-refs.lock` file is found but not pruned (owner alive or too young). | `lock_path`, `lock_age_s`, `decline_reason` |
| 28 | `REFS_LOCK_ORPHAN_PRUNED` | git-finalizer.js:310 | An orphaned refs lock file is detected (owner dead) and safely removed. | `lock_path`, `lock_age_s`, `lock_mtime` |
| 29 | `RENAME_FAILED` | orchestrator.js:2959, :2974 | Slice file rename operation (e.g. IN_PROGRESS → DONE) fails. | _(variable — detail object)_ |
| 30 | `RESTAGED` | new-slice.js:385, orchestrator.js:5131 | Slice is restaged — moved back to STAGED from a terminal or wedged state. | _(none)_ |
| 31 | `RETURN_TO_STAGE` | orchestrator.js:4068, :4077, :4097 | Slice is manually moved back from a terminal state to STAGED via API. | `from_event`, `reason`, `body_source` |
| 32 | `ROM_ABORTED` | orchestrator.js:4330 | Rom session is manually aborted by operator. | `round`, `reason` |
| 33 | `ROM_ESCALATE` | orchestrator.js:4576 | Slice is escalated from fast path because it is broken. | `reason` |
| 34 | `ROM_PAUSED` | orchestrator.js:4228 | Rom session is paused on operator request. | `round` |
| 35 | `ROM_RESUMED` | orchestrator.js:4261 | Rom session is resumed after being paused. | `round` |
| 36 | `ROM_SESSION_FRESH` | orchestrator.js:2112, :2121 | Rom starts a fresh Claude session (no prior session or session cleared). | `session_id`, `round`, `reason_for_fresh` |
| 37 | `ROM_SESSION_RESUMED` | orchestrator.js:2117 | Rom resumes an existing Claude session instead of starting fresh. | `session_id`, `round`, `reason_for_fresh` (null) |
| 38 | `SLICE_DEFERRED` | orchestrator.js:2998 | Slice squash is deferred because the gate is currently running. | `reason` |
| 39 | `SLICE_MERGED_TO_MAIN` | orchestrator.js:6334 | Slice is merged from dev to main as part of the gate process. | `merge_sha` |
| 40 | `SLICE_SQUASHED_TO_DEV` | orchestrator.js:6093 | Slice is squash-merged into the dev branch. | `dev_tip_sha`, `squash_sha` |
| 41 | `STALE_LOCK_DETECTED` | git-finalizer.js:470 | During cycle-start sweep, a stale .git/index.lock blocks progress but owner may still be alive. | `heartbeat_status`, `last_activity_ts`, `decline_reason`, `activity_age_s`, `in_progress`, `alive_reason` |
| 42 | `STATE_FILES_ARCHIVED` | orchestrator.js:3051 | Terminal state files are moved to the archive directory. | `terminal_state`, `moved` |
| 43 | `WORKTREE_CREATED` | orchestrator.js:1533 | Git worktree is created for a slice branch. | `path`, `branch` |
| 44 | `WORKTREE_ORPHAN_PRUNED` | git-finalizer.js:368, :534 | A half-created worktree directory is cleaned up after a failed operation. | `op`, `artifact` |
| 45 | `WORKTREE_REMOVED` | orchestrator.js:1584 | Git worktree is removed after slice completion. | `path` |
| 46 | `WORKTREE_SETUP_RETRY` | git-finalizer.js:598 | Worktree creation is retried due to transient lock contention. | `attempt`, `max_retries`, `backoff_ms`, `error` |
| 47 | `gate-abort` | orchestrator.js:5927, :5991, :6235, :6244, :6288, :6365 (via `emitGateTelemetry`) | Gate sequence is aborted for any reason (branch-state-unreadable, no-slices-on-dev, push-rejected, merge-failed, user-abort, etc.). | `reason`, `dev_tip_sha` (optional), `error` (optional) |
| 48 | `gate-mutex-acquired` | state/gate-mutex.js:51 (via `emit`) | Gate-running.json mutex is acquired when gate begins. | `dev_tip_sha`, `bashir_pid`, `bashir_heartbeat_path`, `started_ts` |
| 49 | `gate-mutex-orphan-recovered` | state/gate-mutex.js:204 (via `emit`) | Orphaned gate mutex is detected (Bashir process dead) and recovered. | `recovery_signal`, `held_duration_ms`, `last_heartbeat_age_ms` |
| 50 | `gate-mutex-released` | state/gate-mutex.js:81 (via `emit`) | Gate-running.json mutex is released when gate ends. | `reason`, `held_duration_ms` |
| 51 | `gate-start` | orchestrator.js:5602 (via `emitGateTelemetry`) | Gate sequence begins (Bashir test runner started). | `devTipSha` |
| 52 | `lock-cycle` | orchestrator.js:1376, :1395, :2826, :2922, :6263, :6373 (via `emitGateTelemetry`) | Git lock is acquired or released during merge operations (squash-to-dev, dev-to-main). | `cycle_phase`, `triggering_op`, `held_duration_ms` |
| 53 | `merge-complete` | orchestrator.js:6341 (via `emitGateTelemetry`) | Dev-to-main merge completes successfully during gate. | `merge_sha`, `slices`, `dev_fast_forwarded_to` |
| 54 | `regression-fail` | orchestrator.js:5837, :5886 (via `emitGateTelemetry`) | Regression test suite fails or times out. | `failed_acs`, `reason` (optional), `duration_ms` (optional), `suite_timeout` (optional) |
| 55 | `regression-pass` | orchestrator.js:5854 (via `emitGateTelemetry`) | Regression test suite passes all tests. | `suite_size`, `duration_ms` |

---

**Total unique event names: 55**

## VALID_EVENTS not currently emitted

The following are registered in `state/gate-telemetry.js:VALID_EVENTS` but have no active emission site in the codebase:

- `gate-deferred-squash`
- `gate-drain-completed`
- `gate-state-transition`
- `gate-state-reinitialized`
- `tests-updated`

## Files scanned

| File | Events found |
|---|---|
| `bridge/orchestrator.js` | 42 emission sites (COMMISSIONED through SLICE_MERGED_TO_MAIN, gate telemetry calls) |
| `bridge/git-finalizer.js` | 10 emission sites (LOCK_*, REFS_LOCK_*, WORKTREE_*, STALE_LOCK_*) |
| `bridge/state/gate-mutex.js` | 3 emission sites (gate-mutex-acquired/released/orphan-recovered) |
| `bridge/state/gate-telemetry.js` | 0 direct emissions (defines `emit()` writer + VALID_EVENTS catalogue) |
| `bridge/state/branch-state-recovery.js` | 2 emission sites (BRANCH_STATE_*) |
| `bridge/new-slice.js` | 1 emission site (RESTAGED) |
| `bridge/state/gate-alerts.js` | 0 (pure reader, no writes) |
| `bridge/kira-events.js` | 0 (writes to kira-events.jsonl, not register.jsonl) |
| `bridge/lifecycle-translate.js` | 0 (read-time translator, no writes) |
| `bridge/rr-compute.js` | 0 (reader only) |
| `bridge/state-doctor.js` | 0 (reader only) |
| `bridge/slicelog.js` | 0 (not a register writer) |
| `bridge/scripts/backfill-register.js` | 1 (synthetic DONE events — one-time migration script) |
