---
id: "189"
title: "F-189 — Ops slice investigation panel: prompt + report + review"
from: rom
to: nog
status: DONE
slice_id: "189"
branch: "slice/189"
completed: "2026-04-24T10:15:00.000Z"
tokens_in: 4200
tokens_out: 620
elapsed_ms: 90000
estimated_human_hours: 0.1
compaction_occurred: false
---

## Summary

Implemented the full slice investigation panel from scratch on a fresh `slice/189` branch. The panel lets operators click any slice row (Queue, ACTIVE BUILD, History) to open a right-side drawer showing three panes: **Prompt**, **Rom Report**, and **Nog Review**. Multi-round slices (PARKED/STUCK) render per-round accordions in **both** panes, with the latest round expanded and prior rounds collapsed. All three close affordances (×, Esc, backdrop click) are wired. The backend endpoint validates numeric IDs and returns 400 for non-numeric input.

This is a fresh attempt that correctly implements AC 4 (the Rom Report accordion for multi-round slices) which was the miss on the previous attempt.

## Changes made

### `dashboard/server.js`
- Added `extractRoundSections(body)` helper — parses `## Round N` and `## Nog Review — Round N` sections from multi-round slice body
- Added `buildSliceInvestigation(id, dirs?)` — resolution logic returning `{ id, prompt, report, reviews }`:
  - `prompt`: first available file per precedence (IN_PROGRESS → QUEUED → STAGED → PARKED → STUCK → DONE → ERROR → ACCEPTED)
  - `report`: body of terminal file (DONE → STUCK → ERROR → ACCEPTED), or null
  - `reviews`: from PARKED/STUCK `rounds[]` frontmatter with body sections extracted, or from NOG.md, or `[]`
- Added `GET /api/slice/:id` route (numeric ID validation via regex `\d+`, 404 for unknown, 500 for errors)
- Added 400 catch-all for `/api/slice/*` paths with non-numeric IDs
- Added `module.exports` + `require.main` guard for testability without auto-listen
- Guarded `server.listen()` with `require.main === module`

### `dashboard/lcars-dashboard.html`
- **CSS** (~75 lines): `.inv-overlay`, `.inv-panel`, `.inv-header`, `.inv-tabs`, `.inv-tab`, `.inv-body`, `.inv-pane`, `.inv-empty`, `.inv-loading`, `.inv-round` (`<details>` accordion), `.inv-round-meta`, `.inv-round-verdict`, `.inv-round-body` + markdown typography in both pane and accordion body
- **HTML** (~22 lines): `#inv-panel-overlay` drawer with header (id badge + title + × close), three tabs (Prompt / Rom Report / Nog Review), three `inv-pane` divs
- **JS** (~105 lines):
  - `switchInvTab(tab)` — tab switching
  - `closeInvPanel()` — closes overlay
  - `renderInvAccordion(reviews, mode)` — renders `<details>` per round, latest open; `mode='rom'` uses `r.rom_report`, `mode='nog'` uses `r.nog_review || r.summary`; uses `marked.parse()` for body rendering
  - `openSliceInvestigation(id)` — fetches `/api/slice/:id`, populates all three panes; multi-round → accordion in both report and review panes; single-round → flat render
  - Esc key + backdrop click listeners for close
  - Event delegation on `#queue-list`: click on `.queue-row` (skips buttons, chevron, drag handle) → opens panel
  - Event delegation on `#history-list`: click on `.history-row-main` (skips buttons, chevron) → opens panel
  - Changed `#mission-active-content` onclick to `openSliceInvestigation(currentMission.id)`

### `test/slice-investigation.test.js` (new, 425 LOC)
25 tests across 5 groups:
1. Static analysis of server.js (route regex, 400 handler, exports)
2. File resolution via `buildSliceInvestigation` with temp dirs (7 state scenarios + 404)
3. Path traversal / input validation
4. Dashboard HTML structure (panel elements, tab buttons, AC 4 accordion guard, event delegation, close affordances)
5. No dead imports self-check

## Acceptance criteria verification

| AC | Criterion | Result |
|---|---|---|
| 0 | DONE skeleton first commit | PASS — 13ff63e |
| 1 | `GET /api/slice/:id` returns `{prompt, report, reviews}` with correct precedence; 404 unknown; 400 non-numeric; 400 path-traversal | PASS |
| 2 | Clicking row in Queue/ACTIVE BUILD/History opens investigation panel | PASS — event delegation on queue-list, history-list; onclick on active card |
| 3 | Panel renders markdown (headings, lists, code blocks) | PASS — uses `marked.parse()` already imported |
| 4 | Multi-round slices render accordion in BOTH Rom Report AND Nog Review panes | PASS — `renderInvAccordion` called with 'rom' and 'nog' modes; `reviews.length > 1` guard |
| 5 | Panel closes on ×, Esc, outside click | PASS — all three wired |
| 6 | No `bridge/*` modified | PASS — verified with `git diff main...HEAD --name-only` |
| 7 | Regression tests pass for each seeded state; path traversal rejected; multi-round accordion data structures verified | PASS — 25/25 |
| 8 | Full test suite passes | PASS — all 18 test files, 0 failures |
| 9 | No dead imports in test file | PASS — test 25 self-verifies |
| 10 | Diff ~371 LOC excluding tests (well under 600) | PASS — 371 LOC |

## Commits

- `13ff63e` — slice 189 — DONE skeleton (IN_PROGRESS)
- `b99298d` — slice 189 — /api/slice/:id investigation endpoint
- `aabc3e1` — slice 189 — investigation panel CSS + HTML + JS
- `2182883` — slice 189 — regression tests: file resolution + HTML structure + path traversal
- `43bc003` — slice 189 — DONE: investigation panel complete
- `7eed0c0` — slice 189 — remove dead variable termPath from buildSliceInvestigation (amendment round 2)

## Amendment round 2 note

Nog rounds 1 and 2 both flagged `let termPath = null;` at `server.js:246` and `termPath = p;` at line 248 as a dead variable — declared and assigned but never read. These two lines have been removed. No other changes. All 25 slice-investigation tests pass.
