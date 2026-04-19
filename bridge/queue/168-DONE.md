---
id: "168"
title: "Event-order fix — dev → review → accept → merge canonical order in watcher"
from: rom
to: nog
status: DONE
slice_id: "168"
branch: "slice/168"
completed: "2026-04-19T15:12:00.000Z"
tokens_in: 42000
tokens_out: 8500
elapsed_ms: 720000
estimated_human_hours: 2.0
compaction_occurred: false
---

## Summary

Reordered all four Nog-verdict paths in `bridge/watcher.js` to emit events in the canonical `dev → review → accept → merge` pipeline order. The watcher now writes `REVIEW_RECEIVED` synchronously to the register **before** the decision event (`ACCEPTED`/`REVIEWED`/`STUCK`) and before any merge operation. The async `callReviewAPI` fire-and-forget POST — which was the source of the out-of-order timestamps — has been removed from all four call sites.

The dashboard `/api/bridge/review` endpoint has been demoted to a UI-refresh nudge: it no longer writes `REVIEW_RECEIVED` to `register.jsonl`. The register file watcher already pushes updates to connected clients.

## Changes

### `bridge/watcher.js`
- **`handleAccepted`**: Emit `REVIEW_RECEIVED` (with verdict + reason) → `ACCEPTED` (decision-only, no reason) → rename → merge → `MERGED`. Removed `callReviewAPI` call.
- **`handleApendment`**: Emit `REVIEW_RECEIVED` (with verdict + reason) → `REVIEWED` (decision, no duplicate reason). Removed `callReviewAPI` call.
- **`handleStuck`**: Emit `REVIEW_RECEIVED` (with verdict + reason) → `STUCK` (decision-only, no reason). Removed `callReviewAPI` call.
- **Auto-accept path** (legacy merge slices): Emit `REVIEW_RECEIVED` → `ACCEPTED` (decision-only). Removed `callReviewAPI` call.

### `dashboard/server.js`
- `/api/bridge/review` POST handler no longer calls `writeRegisterEvent`. Returns `{ ok: true, nudge: true }` with status 200. Clearly commented as a UI-refresh nudge only.

### `test/event-order.test.js` (new)
- 16 tests covering all four verdict paths: event ordering, payload correctness (verdict/reason on REVIEW_RECEIVED, no reason on decision events), callReviewAPI removal, and dashboard endpoint demotion.

## Acceptance criteria verification

| AC | Status |
|----|--------|
| 1. Register order: NOG_PASS → REVIEW_RECEIVED → ACCEPTED → MERGED | Met — all registerEvent calls are synchronous and in canonical order |
| 2. ACCEPTED event body has no `reason` field | Met — `{ cycle }` only |
| 3. `grep callReviewAPI( bridge/watcher.js` returns zero call sites | Met — only function definition remains |
| 4. `/api/bridge/review` does not write to register | Met — writeRegisterEvent removed from handler |
| 5. Apendment path: REVIEW_RECEIVED → REVIEWED in order | Met |
| 6. Stuck path: REVIEW_RECEIVED → STUCK in order | Met |
| 7. Auto-accept: REVIEW_RECEIVED → ACCEPTED → MERGED in order | Met |
| 8. Watcher starts cleanly, all tests green | Met — 93 tests across 5 suites, 0 failures |
| 9. Diff limited to watcher.js, server.js, event-order.test.js | Met |
| 10. Dashboard shows correct order after merge | Will be verified post-merge |

## Test results

```
test/apendment-id-retention.test.js  — 10 passed, 0 failed
test/event-order.test.js             — 16 passed, 0 failed
test/lifecycle-events.test.js        — 24 passed, 0 failed
test/nog-return-round2.test.js       — 13 passed, 0 failed
test/pause-resume-abort.test.js      — 30 passed, 0 failed
```
