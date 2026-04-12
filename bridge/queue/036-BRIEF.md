---
id: "036"
title: "Watcher terminal UX fixes"
goal: "The watcher terminal output is clean, informative, and shows the right things to an operator."
from: kira
to: obrien
priority: normal
created: "2026-04-09T19:40:00Z"
references: null
timeout_min: null
---

## Objective

Three terminal output fixes in `bridge/watcher.js`:

## Tasks

1. **Remove uptime from session summary line.** The line currently says "Session: 1 completed · 0 failed · tokens: unknown · uptime 5m". Remove the `uptime` field entirely. It's noise.

2. **Invert the evaluation cycle counter.** Currently shows "Commission 034 (cycle 1 of 5)". Change to show retries remaining, counting down: "Commission 034 (4 retries remaining)" on first attempt, "3 retries remaining" on second, etc. On the first attempt it's 5 retries remaining (cap is 5, used 0). Formula: `retries remaining = cap - cycle`.

3. **Clarify the evaluator invocation line.** Currently says "Invoking Kira evaluator via claude -p". Change to: "Evaluating — fresh claude -p session, commission ACs + DONE report injected". This tells the operator exactly what's happening: no memory, no role context, just the two files.

## Constraints

- Only modify display/print statements in `bridge/watcher.js`. No logic changes.
- Do not change any evaluation logic, file naming, or register events.

## Success Criteria

- [ ] Uptime removed from session summary line
- [ ] Cycle counter shows "N retries remaining" counting down from 5
- [ ] Evaluator invocation line reads "Evaluating — fresh claude -p session, commission ACs + DONE report injected"
- [ ] All other terminal output unchanged
