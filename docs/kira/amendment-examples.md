# Amendment Examples

Two worked examples of the amendment protocol. Reference alongside `KIRA.md §H` and `docs/kira/evaluation-rubric.md`.

---

## Example 1: O'Brien delivered PARTIAL work

**Scenario:** Brief `005` asked O'Brien to create three contract docs and a test harness. O'Brien's report came back with `status: PARTIAL` — the three contract docs exist and are committed, but the test harness was not started due to time constraints. Kira evaluates: three of four success criteria met.

**Kira's action:** Issue amendment `006`, referencing `005`, scoped to the remaining work.

```markdown
---
id: "006"
title: "Amendment: complete test harness from brief 005"
from: kira
to: obrien
priority: normal
created: "2026-04-06T14:00:00Z"
references: "005"
timeout_min: null
---

## Objective

Complete the test harness that was deferred in brief 005 (status: PARTIAL).

## Context

Brief 005 is at `bridge/queue/005-DONE.md`. The three contract docs were delivered
and accepted. The test harness was not started. Pick up on the same branch: `slice/4-contracts`.

## Tasks

1. Create the test harness as described in brief 005's tasks section (task 4).
2. Ensure tests pass locally.
3. Commit on `slice/4-contracts`.

## Constraints

- Do not re-do the contract docs — they are accepted.
- Stay on `slice/4-contracts`.

## Success criteria

1. Test harness exists at the path specified in brief 005.
2. All tests pass.
3. Changes committed on `slice/4-contracts`.
4. Report written to `bridge/queue/006-DONE.md`.
```

---

## Example 2: O'Brien was BLOCKED on a decision

**Scenario:** Brief `007` asked O'Brien to implement a retry policy for the watcher. O'Brien's report came back with `status: BLOCKED` — O'Brien found two viable retry strategies (exponential backoff vs. fixed interval) and needs Kira to decide before proceeding.

**Kira's action:** Read O'Brien's analysis in the report, make the decision, issue amendment `008` with the answer.

```markdown
---
id: "008"
title: "Amendment: retry policy decision for brief 007"
from: kira
to: obrien
priority: normal
created: "2026-04-06T16:00:00Z"
references: "007"
timeout_min: null
---

## Objective

Unblock brief 007: implement the watcher retry policy using the decided strategy.

## Context

Brief 007 is at `bridge/queue/007-DONE.md` (status: BLOCKED). O'Brien presented two
options. Decision: use **fixed interval retry** (3 retries, 10s apart). Rationale: simpler
to reason about in a local queue; backoff adds complexity without meaningful benefit at
this scale.

## Tasks

1. Implement fixed-interval retry in `bridge/watcher.js`: 3 retries, 10 seconds between
   each attempt.
2. Update `bridge/bridge.config.json` if any new config fields are needed.
3. Commit on `slice/5-watcher-retry`.

## Constraints

- Do not implement exponential backoff.
- Do not change the brief or report format.

## Success criteria

1. Watcher retries a failed invocation up to 3 times with 10s intervals.
2. After 3 failures, watcher writes an ERROR file and moves on.
3. Changes committed on `slice/5-watcher-retry`.
4. Report written to `bridge/queue/008-DONE.md`.
```
