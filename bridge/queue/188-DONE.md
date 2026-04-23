---
id: "188"
title: "F-188 — Ops services panel: three-service status + remove Wormhole"
from: rom
to: nog
status: DONE
slice_id: "188"
branch: "slice/188"
completed: "2026-04-22T14:40:00.000Z"
tokens_in: 42000
tokens_out: 9800
elapsed_ms: 4500000
estimated_human_hours: 3.5
compaction_occurred: false
---

## Summary

Replaced the two-pill Ops header (Watcher + Service-health) with a single `#services-panel` showing three individually-addressable service rows: Orchestrator, Server, and Detector. Each row has a status dot, a label (`Name up/down`), and a hover tooltip with actionable detail. Wormhole is fully removed from the dashboard. Approve gate is refined: orchestrator or server down blocks approvals; detector down is an observability gap and leaves approvals enabled.

## Changes

### dashboard/lcars-dashboard.html
- **Removed** Wormhole block from the old `updateHealthPill` tooltip (commit 2)
- **Removed** `.service-health-pill` CSS + the two-pill header markup (commit 3)
- **Added** `#services-panel` with three `.service-row` divs (`data-service="orchestrator|server|detector"`), each with a `.service-dot`, a label span, and a `.service-row-tooltip` (commit 3)
- **Added** CSS for `#services-panel`, `.service-row`, `.service-dot.up/down/stale/unknown`, `.service-row-tooltip`, `.svc-sep` (commit 3)
- **Replaced** `updateHealthPill()` + `updateServiceHealthPill()` with single `updateServicesPanel()` function (commit 4):
  - Orchestrator row: reads `health.watcher` — dot/label/tooltip reflect `up/stale/down`, shows current slice + elapsed when processing
  - Server row: shows up if `/api/health` responded 200 in <3s, down otherwise; tooltip shows response time in ms
  - Detector row: reads `health.hostHealth` — four classified down-states (file missing, stale>30s, container not running, api not ok); up state shows "container running · API ok"
  - File missing → tooltip references `scripts/README-health-detector.md`
- **Updated** approve gate tooltip text to "Orchestrator/Server down — start Docker + watcher before approving." (commit 5)
- **`serviceHealthDown`** flag retained as variable name; semantics narrowed: true only when orchestrator (status==='down') OR server (fetch failed) is down

### test/services-panel.test.js (new)
- 29 tests covering: static HTML structure, no Wormhole, three data-service rows, each service row dot/label for all up/down combinations, detector classified down-states, approve gate for all four cases (orch down, server down, detector-only down, all up), stale-orchestrator does not block

### test/host-health-detector.test.js (updated)
- Updated 6 tests that checked removed elements (`#service-health-pill`, `.pill-green`, `.pill-red`, `updateServiceHealthPill`) to verify equivalent new elements and behaviour

## Behavior changes from 183

| Behavior | 183 | 188 |
|---|---|---|
| Header element | Two pills: green "online" + red/green "Service up/down" | One `#services-panel` with three rows |
| Wormhole row | Present in Watcher tooltip ("not yet used this session") | **Removed entirely** |
| Approve gate blocker | Detector down → blocked | Orchestrator or Server down → blocked; Detector down → **warning only, approve allowed** |
| Detector down UX | Generic "Service down" label | Classified reason + actionable tooltip (4 cases) |
| Server health | Implicit (page loaded = server up) | Explicit: `/api/health` fetch result displayed in Server row |

The approve-gate relaxation is intentional: the detector is an observability tool, not a functional dependency. A missing or crashed detector does not prevent O'Brien or the watcher from accepting slices. Blocking approvals for a non-functional dependency was creating unnecessary friction.

## Acceptance criteria

- [x] AC 0: DONE skeleton committed on `slice/188` as first commit
- [x] AC 1: `grep -ni wormhole dashboard/lcars-dashboard.html` → no output
- [x] AC 2: Single `#services-panel` with exactly three rows (orchestrator, server, detector); no `#service-health-pill`
- [x] AC 3: Each row has `data-service` attribute + hover tooltip with status, age, reason-when-down
- [x] AC 4: Detector row shows `scripts/README-health-detector.md` install reference when `host-health.json` missing
- [x] AC 5: Approve button disabled when orchestrator or server down; enabled when only detector down; enabled when all up
- [x] AC 6: No `bridge/*` source files modified (only `bridge/queue/188-DONE.md` added)
- [x] AC 7: All regression tests pass (29 new + 28 updated); no Wormhole substring; approve gate correct
- [x] AC 8: Full test suite passes — all 11 test files, 184 total tests, 0 failures
- [x] AC 9: Dashboard diff = 236 LOC (well under 400)

## Test results

```
test/apendment-id-retention.test.js     10 passed, 0 failed
test/event-order.test.js                19 passed, 0 failed
test/git-finalizer.test.js               8 passed, 0 failed
test/host-health-detector.test.js       28 passed, 0 failed
test/lifecycle-events.test.js           24 passed, 0 failed
test/lifecycle-translate.test.js        passed
test/nog-return-round2.test.js          13 passed, 0 failed
test/orchestrator-no-report-rescue.test.js 23 passed, 0 failed
test/pause-resume-abort.test.js         30 passed, 0 failed
test/services-panel.test.js             29 passed, 0 failed
test/verdict-parser-widening.test.js    passed
```
