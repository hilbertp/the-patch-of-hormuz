# Bashir-Gate Runbook

Operational runbook for the Bashir quality-gate subsystem.
Written for an operator who knows git basics but has not seen this codebase.

---

## 1. Quick Reference (3am one-pager)

```
Check first:
  node bridge/state-doctor.js        # unified state view + anomalies

Key files:
  bridge/state/branch-state.json     # branch + gate state
  bridge/state/gate-running.json     # mutex (present = gate active)
  bridge/state/bashir-heartbeat.json # Bashir liveness signal
  bridge/heartbeat.json              # orchestrator liveness
  bridge/.run.pid                    # orchestrator PID
  bridge/.pipeline-paused            # pause flag (present = halted)
  bridge/register.jsonl              # event log (append-only)

Common fixes:
  Mutex orphan (Bashir crashed):     rm bridge/state/gate-running.json
                                     then restart orchestrator
  Pipeline paused:                   rm bridge/.pipeline-paused
  Main lock stuck:                   scripts/unlock-main.sh (Worf only)
  Orchestrator down:                 Check bridge/.run.pid, restart
```

---

## 2. State Files Map

| File | Writer | Purpose | Format |
|---|---|---|---|
| `bridge/state/branch-state.json` | Orchestrator | Tracks branch tips and gate lifecycle state. `branch` section: per-branch metadata. `gate` section: current gate status (IDLE, GATE_RUNNING, GATE_PASSED, GATE_FAILED). | JSON |
| `bridge/state/gate-running.json` | Orchestrator (gate-start) | Mutex file. Presence means a gate run is active. Removed on gate completion or abort. Contains `started_at`, `slice_id`, `branch`. | JSON |
| `bridge/state/bashir-heartbeat.json` | Bashir process | Liveness signal. Updated periodically while Bashir is running. Contains `ts` (ISO 8601), `slice_id`. Heartbeat-primary liveness is the canonical signal per ADR section 4. | JSON |
| `bridge/heartbeat.json` | Orchestrator | Orchestrator liveness. Contains `ts`, `status`, `current_slice`, queue counts. | JSON |
| `bridge/.run.pid` | Orchestrator | PID of the running orchestrator process. | Plain text (integer) |
| `bridge/.pipeline-paused` | Operator / UI | Pause flag. Presence halts slice dispatch. Contents ignored; existence is the signal. | Empty or any |
| `bridge/register.jsonl` | Orchestrator | Append-only event log. One JSON object per line. Events include gate-start, gate-pass, gate-fail, gate-abort, and orchestrator lifecycle events. | JSONL |

---

## 3. Failure-Mode Catalog

### F1: Mutex orphaned, heartbeat stale

**Trigger:** Bashir process crashed or was killed mid-test. The mutex file
(`gate-running.json`) remains but Bashir is no longer updating its heartbeat.

**Detection:** `state-doctor` flags "mutex present but heartbeat stale" in
Anomalies section. Heartbeat `ts` is older than the staleness threshold
(default: 120 seconds).

**Recovery procedure:**
```bash
# 1. Confirm Bashir is not running
ps aux | grep -i bashir

# 2. Remove the orphaned mutex
rm bridge/state/gate-running.json

# 3. Restart the orchestrator (recovery scan will re-derive state)
node bridge/orchestrator.js
```

**Post-recovery verification:**
```bash
node bridge/state-doctor.js
# Confirm: Gate section shows IDLE, no anomalies flagged
```

---

### F2: Mutex orphaned, heartbeat fresh

**Trigger:** Bashir process is alive but unresponsive (hung). Mutex is present,
heartbeat is still being updated, but Bashir is not making progress.

**Detection:** Operator notices gate has been running unusually long.
`state-doctor` shows Gate: GATE_RUNNING with a long elapsed time, but no
heartbeat-stale anomaly.

**Recovery procedure:**
```bash
# 1. Identify the Bashir process
ps aux | grep -i bashir

# 2. Kill the hung process (this will cause heartbeat to go stale)
kill <bashir-pid>

# 3. Wait ~2 minutes for heartbeat to become stale, then follow F1 recovery
# OR proceed immediately:
rm bridge/state/gate-running.json
node bridge/orchestrator.js
```

**Post-recovery verification:**
```bash
node bridge/state-doctor.js
# Confirm: Gate section shows IDLE, no anomalies
```

**Warning:** Do NOT delete the mutex while the heartbeat is fresh unless you
have confirmed Bashir is truly hung. A fresh heartbeat means the process may
still be working.

---

### F3: branch-state.json corrupt or partial-write

**Trigger:** Crash or power loss during a write to `branch-state.json`,
leaving the file with invalid JSON or truncated content.

**Detection:** `state-doctor` reports "branch-state.json: parse error" or
the orchestrator fails to start with a JSON parse error.

**Recovery procedure:**
```bash
# 1. Back up the corrupt file for diagnosis
cp bridge/state/branch-state.json bridge/state/branch-state.json.corrupt

# 2. Remove the corrupt file
rm bridge/state/branch-state.json

# 3. Restart the orchestrator
# Recovery scan re-derives the branch section from git.
# Gate section initializes to IDLE.
node bridge/orchestrator.js
```

**Post-recovery verification:**
```bash
node bridge/state-doctor.js
# Confirm: branch-state.json is readable, gate shows IDLE
```

**Loss:** Gate's `last_failure` context (last failure reason/timestamp) is
lost. The branch section is fully recoverable from git.

---

### F4: Gate state says GATE_RUNNING but no mutex file

**Trigger:** Drift between `branch-state.json` (gate section says
GATE_RUNNING) and the filesystem (no `gate-running.json` mutex).

**Detection:** `state-doctor` flags "gate state RUNNING but no mutex" in
Anomalies.

**Recovery procedure:**
```bash
# 1. Emit a gate-abort to reset the gate state
# Use the existing abort path (details depend on orchestrator CLI;
# if no CLI abort exists, restart the orchestrator — recovery scan
# will detect the inconsistency and reset gate to IDLE)
node bridge/orchestrator.js

# 2. The orchestrator drains the deferred queue on restart
```

**Post-recovery verification:**
```bash
node bridge/state-doctor.js
# Confirm: Gate shows IDLE, no anomalies, deferred queue drained
```

---

### F5: Squash-merge conflict on dev

**Trigger:** A slice's squash-merge into dev encounters conflicts.

**Detection:** Gate run fails with merge-conflict error. `register.jsonl`
shows a `gate-fail` event with conflict details.

**Recovery procedure:**
```bash
# This follows the existing pattern: orchestrator's mergeBranch
# merges main-into-branch first, then slice-into-dev.
# On conflict, Rom is re-invoked to resolve.

# 1. Check the gate failure details
tail -5 bridge/register.jsonl | grep gate-fail

# 2. The orchestrator will re-invoke Rom for conflict resolution
# No manual action needed unless Rom also fails

# 3. If Rom fails, escalate to manual resolution:
git checkout dev
git merge --no-ff slice/<N>
# Resolve conflicts manually, then commit
```

**Post-recovery verification:**
```bash
git log --oneline dev -3
# Confirm the slice commit landed on dev
node bridge/state-doctor.js
```

---

### F6: main-lock left engaged after crashed gate run

**Trigger:** Gate run crashed between `unlock-main.sh` and `lock-main.sh`
in the merge path's finally block. Main-branch files are read-only when
they should be writable (or vice versa).

**Detection:** Operator or orchestrator gets "Permission denied" on files
that should be writable. `state-doctor` does not directly detect this
(filesystem permissions are outside its read scope).

**Recovery procedure:**
```bash
# Worf-only operation. Do not delegate to arbitrary operators.
scripts/unlock-main.sh

# Then re-engage the lock after confirming state is clean:
scripts/lock-main.sh
```

**Post-recovery verification:**
```bash
ls -la dashboard/lcars-dashboard.html
# Confirm expected permissions are restored
```

---

### F7: Bashir runs forever without finishing

**Trigger:** Bashir process is alive and updating heartbeat, but never
completes (infinite loop, waiting on external resource, etc.).

**Detection:** `state-doctor` shows Gate: GATE_RUNNING with long elapsed
time. Heartbeat is fresh. No anomaly flagged (this is a judgment call,
not a detectable anomaly).

**Recovery procedure:**
```bash
# Option A: Use the UI Abort button (if dashboard is running)

# Option B: Set the pause flag to halt dispatch
touch bridge/.pipeline-paused

# Option C: Kill Bashir directly
ps aux | grep -i bashir
kill <bashir-pid>
# Then follow F1 recovery (mutex orphan)
rm bridge/state/gate-running.json
node bridge/orchestrator.js
```

**Post-recovery verification:**
```bash
node bridge/state-doctor.js
# Confirm: Gate IDLE, no pause flag (if you set one, remove it)
rm bridge/.pipeline-paused  # if applicable
```

---

### F8: Deferred slices on orchestrator crash

**Trigger:** Orchestrator crashes while slices are deferred (queued behind
an active gate run). Deferred slices exist as ACCEPTED files but have not
been dispatched.

**Detection:** `state-doctor` lists deferred slices in its output. After
restart, recovery scan detects ACCEPTED files.

**Recovery procedure:**
```bash
# 1. Restart the orchestrator
node bridge/orchestrator.js

# Recovery scan walks ACCEPTED files and replays drain in FIFO
# order (sorted by accepted_ts).
```

**Post-recovery verification:**
```bash
node bridge/state-doctor.js
# Confirm: deferred slices are being processed, no anomalies
ls bridge/queue/*ACCEPTED* 2>/dev/null
# Should be empty after drain completes
```

---

### F9: dev/main divergence after gate-pass but before fast-forward

**Trigger:** Orchestrator crashes after the gate passes (Bashir approved
the merge to main) but before the fast-forward of dev to match main.

**Detection:** `state-doctor` may show branch tip mismatch. `git log`
shows main has commits that dev does not.

**Recovery procedure:**
```bash
# 1. Restart the orchestrator
node bridge/orchestrator.js

# Recovery scan re-runs the fast-forward:
# git update-ref refs/heads/dev <main-sha>
```

**Post-recovery verification:**
```bash
git rev-parse main
git rev-parse dev
# Both should point to the same commit
node bridge/state-doctor.js
```

---

### F10: External force-push

**Trigger:** Someone outside the system force-pushed to main or dev,
changing history in a way the orchestrator did not expect.

**Detection:** `state-doctor` compares `branch-state.json`'s
`main.tip_sha` with `git rev-parse main` and flags drift if they differ.

**Recovery procedure:**
```
This is outside the architectural threat model.
No automated recovery is defined.

If detected:
1. Do NOT restart the orchestrator (it may compound the problem).
2. Escalate to Philipp immediately.
3. Preserve branch-state.json and register.jsonl for forensics.
```

**Post-recovery verification:** At Philipp's direction.

---

### F11: gate-running.json present but unparseable

**Trigger:** Corrupt write to the mutex file, leaving invalid JSON.

**Detection:** `state-doctor` flags parse error on `gate-running.json`.

**Recovery procedure:**
```bash
# Treat as F1 (orphan). The file is useless if unparseable.

# 1. Confirm Bashir is not running
ps aux | grep -i bashir

# 2. Remove the corrupt mutex
rm bridge/state/gate-running.json

# 3. Restart orchestrator
node bridge/orchestrator.js
```

**Post-recovery verification:**
```bash
node bridge/state-doctor.js
# Confirm: Gate IDLE, no anomalies
```

---

### F12: Pause flag set

**Trigger:** Operator or UI deliberately set `bridge/.pipeline-paused` to
halt dispatch. This is not a failure but a deliberate operational hold.

**Detection:** `state-doctor` surfaces "Pause flag: PRESENT" in its output.

**Recovery procedure:**
```bash
# When ready to resume:
rm bridge/.pipeline-paused
```

**Post-recovery verification:**
```bash
node bridge/state-doctor.js
# Confirm: Pause flag shows (absent)
```

---

## 4. Escalation Criteria

Wake Philipp when:

1. **Drift between branch-state.json and git** (F10-shaped). Any mismatch
   between recorded tip SHAs and actual git refs indicates external
   interference or a bug in the orchestrator's bookkeeping.

2. **Mutex orphan not auto-handled after restart.** If the orchestrator's
   recovery scan runs and the mutex is still present afterward, something
   unexpected is preventing cleanup.

3. **Force-push detection.** Any `state-doctor` anomaly indicating ref
   history was rewritten.

4. **Lock state where `unlock-main.sh` fails.** If the unlock script
   errors or leaves files in an unexpected permission state.

5. **Repeated gate failures on the same slice.** If a slice fails the gate
   more than twice in succession, the failure may be systemic rather than
   a flaky test.

6. **Unrecognized anomaly in state-doctor output.** If the operator cannot
   map the anomaly to one of F1-F12 above.

---

## 5. Hand-off-to-Worf Checklist

When an operator other than Worf has been handling an incident and needs to
hand off:

- [ ] Run `node bridge/state-doctor.js` and save the output
- [ ] Copy the last 50 lines of `bridge/register.jsonl`
- [ ] Note which failure mode (F1-F12) was identified
- [ ] Note what recovery steps were taken and their results
- [ ] Note any anomalies that remain unresolved
- [ ] Confirm whether the orchestrator is currently running (`bridge/.run.pid`)
- [ ] Confirm whether the pipeline is paused (`bridge/.pipeline-paused`)
- [ ] Confirm the current gate state from `branch-state.json`
- [ ] Hand all of the above to Worf before stepping away
