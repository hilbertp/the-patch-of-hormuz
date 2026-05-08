---
id: J-merge-button-pass
category: gate-merge
status: draft
last_reviewed: 2026-05-08
---

# Press merge button and gate passes

## What the user is trying to accomplish

Philipp reviews the accumulated slices on dev (via the RR regression-risk dial and commits-ahead indicator), decides the risk is acceptable, clicks "Merge to main," and Bashir's gate runs. All tests pass, the merge completes, and the slices land on main.

## Preconditions

- One or more slices are in ACCEPTED state on the dev branch
- The Branch Topology panel shows commits ahead of main (non-zero)
- RR dial shows a risk percentage (computed from Nog flags, slice count, time since last merge)
- Merge button is enabled (not in GATE_RUNNING or GATE_FAILED state)
- Bashir is alive (orchestrator can spawn `claude -p` with the Bashir gate role)

## Steps

1. Philipp observes the Branch Topology panel: dev has 3 commits ahead, RR is 45% (mid-zone yellow)
2. Philipp clicks the "Merge to main" button
3. The button is replaced by a progress widget showing three steps: "Tests updated" → "Regression pass" → "Merge"
4. The header health pill changes to state "BATCH GATE" (warn color)
5. The orchestrator emits a `gate-start` event and writes `bridge/state/gate-running.json`
6. Bashir is invoked via `claude -p` with the list of unmerged slice files on dev
7. Bashir reads the slices, authors/updates tests in the `regression/` directory, and commits them to dev
8. Bashir emits `tests-updated` event; step 1 card transitions to done (green checkmark)
9. Bashir runs the full test suite and all tests pass
10. Bashir emits `regression-pass` event; step 2 card transitions to done
11. The orchestrator unlocks main, squash-merges the slice→dev branches (or they're already squashed), merges dev→main with no-ff, relocks main
12. The orchestrator emits `merge-complete` event
13. Step 3 card transitions to done; the progress widget closes
14. The RR dial animates a drain from 45% → 0% over ~1.2s, then resets to green `--ok` color
15. The Branch Topology graph updates: new merge dot appears on main with a checkmark glyph, dev fast-forwards to main's tip
16. Header health pill reverts to "ONLINE"

## Expected outcomes

- `gate-running.json` is created at gate-start and deleted on merge-complete
- All three step cards in the progress widget transition from pending → active → done in order
- Bashir's heartbeat file is written periodically while the gate runs (for liveness tracking)
- Register contains events: `gate-start`, `tests-updated`, `regression-pass`, `merge-complete`
- Main branch has a new merge commit with a `Slices: <id1>,<id2>,<id3>` trailer
- Dev branch tip == main branch tip immediately after merge (fast-forward applied)
- Active Build panel updates to show Rom is idle / standing by (no in-flight slice)
- History panel shows all three merged slices with `ACCEPTED` outcome badges
- Commits-ahead counter resets to 0; RR resets to 0% (green)
- Merge button re-appears and is re-enabled (disabled during GATE_RUNNING state)

## Known failure modes

- **Bashir times out during test run.** The regression suite may be slow or hang. *Recovery:* Bashir's heartbeat is stale; orchestrator detects orphan and aborts gate. Investigate why Bashir hung and retry merge.
- **Merge conflicts occur during dev→main merge.** One of the slices may have touched files that were also changed on main since branch creation. *Recovery:* This should not happen if all slices were created from main and rebased on dev before ACCEPTED. If it does, orchestrator should halt and emit `MERGE_FAILED` with conflict details.
- **Main lock is already held (e.g., by a crashed process).** The unlock-main.sh script can't acquire the lock. *Recovery:* Check `bridge/.git/index.lock` and delete if stale. Restart orchestrator.
- **Regression-fail occurs (one or more tests fail).** Journey continues to J-gate-fail-retry.

## Sources

- `docs/architecture/BRANCHING-FOR-BASHIR-GATE-ADR.md` — gate state machine, merge flow, no-ff merge, dev fast-forward
- `docs/contracts/slice-format.md` — slice ACCEPTED state
- `repo/.claude/roles/obrien/inbox/HANDOFF-OPS-REDESIGN-SPEC-FROM-ZIYAL.md` — Branch Topology panel, gate progress widget, RR dial drain animation, merge button
- `docs/runbooks/RUNBOOK-BASHIR-GATE.md` — gate operational state and heartbeat liveness
- `bridge/orchestrator.js` — gate orchestration, merge commit generation, branch-state.json updates
- `scripts/unlock-main.sh`, `scripts/lock-main.sh` — main-lock protocol

## Open questions

- The RR dial "drains to 0%" over 1.2s — is this wall-clock time or tied to the `merge-complete` event latency? If the merge is very fast (< 1.2s), does the drain animation still run for 1.2s?
- Does the Merge button show a tooltip during the gate-running state explaining what Bashir is doing? Or is it just replaced silently?
- If Rom has commissioned a new slice while the gate is running, that slice is deferred (stays in ACCEPTED, not squashed to dev). After the merge completes and the mutex is deleted, is the deferred slice squashed immediately, or does it wait for the next poll cycle?
