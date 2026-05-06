---
id: "295"
title: "F-Rounds-1 — Unify slice round counter + enforce MAX_ROUNDS on every re-dispatch"
from: rom
to: nog
status: DONE
slice_id: "295"
branch: "slice/295"
completed: "2026-05-06T08:12:00.000Z"
tokens_in: 48000
tokens_out: 8500
elapsed_ms: 420000
estimated_human_hours: 2.5
compaction_occurred: false
---

## Summary

Unified the slice round counter to a single `MAX_ROUNDS = 5` constant and enforced it on every re-dispatch path. The slice-182 R29 blowout class is now impossible — no path can exceed round 5.

## Increment sites inventory

Every round increment/tracking site in `bridge/orchestrator.js`:

| Site | Location | Action taken |
|------|----------|--------------|
| `countNogRounds()` | L3184-3187 | **Kept** — canonical round derivation (counts `## Nog Review — Round N` headers) |
| `invokeNog` round calc | L3245 | **Kept** — `existingRounds + 1`, feeds the `round > MAX_ROUNDS` check |
| `invokeNog` round > 5 check | L3249 | **Unified** — now uses `MAX_ROUNDS` constant instead of hardcoded 5 |
| `appendRoundEntry` calls | Multiple | **Kept** — telemetry writes, no increment logic |
| `handleNogReturn` frontmatter writes | L3744-3745 | **Kept** — writes `round` and `apendment_cycle` to same value |
| `verdict_unreadable` path | L3476-3519 | **NEW GUARD** — `if (round >= MAX_ROUNDS)` → terminal before `handleNogReturn` |
| `REJECTED` path | L3701-3737 | **NEW GUARD** — `if (round >= MAX_ROUNDS)` → terminal before `handleNogReturn` |
| `nog-active.json` round write | L3393 | **Kept** — feeds Nog lane display, uses same `round` variable |
| `romRound` for session resume | L2101 | **Kept** — reads from frontmatter `round` field (set by `handleNogReturn`) |

## Changes made

### 1. `MAX_ROUNDS` constant (orchestrator.js L85)

```js
const MAX_ROUNDS = 5; // Absolute cap — no round 6, ever, on any path.
```

Replaces the hardcoded `5` in the `invokeNog` check.

### 2. Guard on `verdict_unreadable` re-dispatch path

Before `handleNogReturn` is called, checks `if (round >= MAX_ROUNDS)`. If true:
- Emits `MAX_ROUNDS_EXHAUSTED` register event
- Renames slice to STUCK
- Cleans up worktree
- Returns (no re-dispatch)

### 3. Guard on `REJECTED` re-dispatch path

Same pattern as above. Before `handleNogReturn`, checks `round >= MAX_ROUNDS`.

### 4. Unified dashboard round display (`dashboard/lcars-dashboard.html`)

Rewrote `getRound()` to scan all register events (not just COMMISSIONED) for the highest `round` field, matching `getTerminalRound()` logic. All three surfaces now agree:

- **Active Build header** → `getRound(sliceId)` → max `round` field from register events
- **Nog lane card** → `nogActive.round` → set by orchestrator from `countNogRounds + 1`
- **History row** → `getTerminalRound(sliceId, events)` → max `round` field from register events

### 5. Tests (`bridge/test/max-rounds-unified.test.js`)

12 tests across 5 describe blocks:
- MAX_ROUNDS constant exists and equals 5
- REJECTED at round 5 → terminal, round 4 → allows re-dispatch
- invokeNog blocks at round 6, allows at round 5
- verdict_unreadable cascade terminates at round 5
- All three Ops surfaces show identical round 3 for synthetic slice
- getRound respects RESTAGED cutoff
- STUCK file exists after terminal, no pickup candidates remain

## Test results

```
bridge/test/max-rounds-unified.test.js: 12 pass, 0 fail
bridge/test/gate-recovery.test.js:      15 pass, 0 fail
test/nog-return-round2.test.js:         13 pass, 0 fail
```

## Files changed

- `bridge/orchestrator.js` — MAX_ROUNDS constant + two guards
- `dashboard/lcars-dashboard.html` — unified `getRound()` function
- `bridge/test/max-rounds-unified.test.js` — new test file
- `bridge/queue/295-DONE.md` — this report
