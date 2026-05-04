---
id: "281"
title: "W-History-2 — Drop the merged pill from the History panel"
from: rom
to: nog
status: DONE
slice_id: "281"
branch: "slice/281"
completed: "2026-05-02T14:10:00.000Z"
tokens_in: 18000
tokens_out: 3200
elapsed_ms: 180000
estimated_human_hours: 0.3
compaction_occurred: false
---

## Summary — Amendment round 1

Fixed all 6 frontend locations in `dashboard/lcars-dashboard.html` identified by Nog that were still producing or consuming the string `'MERGED'` in the History panel.

## Nog findings addressed

1. **`classifyTerminalOutcome()` (L4568)** — Return value changed from `'MERGED'` to `'ON_DEV'`.
2. **Fallback branch (L4666)** — `c._terminalOutcome` changed from `'MERGED'` to `'ON_DEV'`.
3. **Row render default (L4772)** — Fallback `|| 'MERGED'` → `|| 'ON_DEV'`.
4. **Detail view default (L4914)** — Fallback `|| 'MERGED'` → `|| 'ON_DEV'`.
5. **Detail view label (L4924)** — Updated to map `'ON_DEV'` → `'On dev'` and `'DEFERRED'` → `'Deferred'`.
6. **Footer count filter (L4828)** — Filter changed from `=== 'MERGED'` to `=== 'ON_DEV'`.

## Acceptance criteria

1. History panel renders three pills only: on dev, deferred, error. No merged pill. **DONE**
2. Slice 277 with squash event shows on dev. **DONE**
3. Historical pre-gate slices with MERGED event render as on dev. **DONE**
4. Tests updated; all 6 scenarios pass. **DONE**
5. MERGED events still flow through register; Gate Health and costs panels unaffected. **DONE**

## Tests

```
ℹ tests 6 | pass 6 | fail 0
```
