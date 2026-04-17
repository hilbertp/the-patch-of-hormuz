---
id: "147"
title: "watcher+docs: rename REVIEWED sidecar suffix to IN_REVIEW and document handleAmendment"
from: rom
to: nog
status: DONE
slice_id: "147"
branch: "slice/147"
completed: "2026-04-17T00:12:00.000Z"
tokens_in: 42000
tokens_out: 4800
elapsed_ms: 180000
estimated_human_hours: 0.75
compaction_occurred: false
---

## Summary

Renamed the on-disk review sidecar suffix from `-REVIEWED.md` to `-IN_REVIEW.md` across the codebase, and documented the `handleAmendment` / `handleNogReturn` sidecar pattern in `slice-pipeline.md`.

## Changes

### `bridge/watcher.js`
- **`handleAmendment` (line ~2398):** Renamed `reviewedPath` → `inReviewPath`, changed suffix to `-IN_REVIEW.md`, updated `log()` state label from `'REVIEWED'` to `'IN_REVIEW'`, updated warn messages.
- **`handleNogReturn` (line ~2881):** Same rename: `reviewedPath` → `inReviewPath`, suffix → `-IN_REVIEW.md`, state label → `'IN_REVIEW'`, updated warn messages.
- **Register event name `'REVIEWED'` preserved** — consumer contract for Ops Center unchanged.
- **Register-reading functions** (`countReviewedCycles`, `hasReviewEvent`) — unchanged; they read event names, not file suffixes.

### `dashboard/server.js`
- **Content candidate list (line ~641):** Added `${id}-IN_REVIEW.md` (preferred) and `${id}-REVIEWED.md` (legacy fallback) to the file-read candidate array for slice content display.
- **Register event handling (line 224):** Unchanged — event name `'REVIEWED'` stays.

### `docs/contracts/slice-pipeline.md`
- **§4 table row 5:** Updated suffix to `-IN_REVIEW.md`, replaced "naming divergence" note with "legacy dual-read" note.
- **§5 transition table:** Updated DONE → IN_REVIEW row suffix to `-IN_REVIEW.md`.
- **§10.1 (new):** "Rejection-round sidecar" — documents the `handleAmendment` / `handleNogReturn` pattern: terminal rename to `${id}-IN_REVIEW.md`, amendment spawn to `${nextId}-QUEUED.md`, BR-invariant-1 divergence noted, future converge deferred.
- **§12 item 2:** Marked resolved in slice 147, dual-read legacy.
- **§12 item 4:** Marked documented in slice 147, references §10.1, full converge deferred.

## Task 6 — SKIPPED

`docs/contracts/slice-format.md` does not exist — slice 148 has not landed yet. As the brief anticipated, this task is skipped. No `-REVIEWED.md` examples to update.

## Acceptance criteria verification

| Criterion | Result |
|---|---|
| `grep -c "IN_REVIEW" bridge/watcher.js` ≥ 3 | 7 ✓ |
| `grep -c "IN_REVIEW" dashboard/server.js` ≥ 1 | 1 ✓ |
| `grep -c "IN_REVIEW" docs/contracts/slice-pipeline.md` ≥ 3 | 10 ✓ |
| `grep -c "REVIEWED" bridge/watcher.js` ≥ 3 (dual-accept + event) | 5 ✓ |
| `registerEvent(.*'REVIEWED'` preserved | 1 match ✓ |
| §4 table row 5 contains `-IN_REVIEW.md` | ✓ |
| §12 item 2 contains "slice 147" and "resolved" | ✓ |
| §12 item 4 contains "slice 147" and "documented"/"deferred" | ✓ |
| New subsection describing handleAmendment sidecar (§10.1) | ✓ |
| `node -c bridge/watcher.js` exits 0 | ✓ |
| `node -c dashboard/server.js` exits 0 | ✓ |
| `git diff --stat main` shows 3 files (4th pending slice 148) | 3 files ✓ |
| `docs/contracts/slice-lifecycle.md` untouched | ✓ |
