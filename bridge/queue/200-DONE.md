---
id: "200"
title: "F-195 — new-slice.js: --restage <id> flag with auto-archive and history preservation"
from: rom
to: nog
status: DONE
slice_id: "200"
branch: "slice/200"
completed: "2026-04-24T12:10:00.000Z"
tokens_in: 28500
tokens_out: 9200
elapsed_ms: 2940000
estimated_human_hours: 2.5
compaction_occurred: false
---

## Summary

Added `--restage <id>` flag to `bridge/new-slice.js`. Re-staging a slice now:
- Preserves the original numeric ID (skips nextSliceId max+1 assignment)
- Archives all terminal queue files for that ID to `bridge/trash/` as `<file>.attempt<N>`
- Renames the prior `slice/<id>` git branch to `slice/<id>-attempt<N>` (N = max existing attempt + 1)
- Strips `rounds:` and `round:` fields from body-file frontmatter before writing the new STAGED file
- Emits a `RESTAGED` event (re-uses existing detection logic — fires because prior COMMISSIONED exists)
- Validates: rejects if no prior history exists; rejects if slice is currently active

Without `--restage`, existing max+1 flow is completely unchanged.

## Acceptance criteria

- [x] AC0: DONE skeleton committed first
- [x] AC1: `--restage 999` writes `bridge/staged/999-STAGED.md` with `id: "999"`
- [x] AC2: Terminal queue files archived to `bridge/trash/` with `.attempt<N>` suffix
- [x] AC3: `slice/<id>` git branch renamed to `slice/<id>-attempt<N>`; missing branch skipped silently
- [x] AC4: `rounds:`/`round:` stripped from body-file frontmatter
- [x] AC5: `RESTAGED` event appended to `register.jsonl`
- [x] AC6: `--restage <id>` with no prior history → exit 1, named error
- [x] AC7: `--restage <id>` with active slice → exit 1, named error with state
- [x] AC8: Without `--restage`, existing flow unchanged
- [x] AC9: Second re-stage produces `.attempt2` suffix; test covers both artifact and branch numbering
- [x] AC10: Full test suite passes (all 18 test files, 230+ tests)
- [x] AC11: `--help` usage line updated; top-of-file doc block explains when to use `--restage`
- [x] AC12: Diff ~250 LOC including tests (bridge/new-slice.js: +197 lines; test/new-slice-restage.test.js: +382 lines)

## Files changed

- `bridge/new-slice.js` — added `--restage` flag, validation, archival, branch-rename, frontmatter-strip, doc
- `test/new-slice-restage.test.js` — 12 regression tests covering all ACs

## Notes

- `DS9_TRASH_DIR` env var wired alongside `DS9_QUEUE_DIR`/`DS9_STAGED_DIR`/`DS9_REGISTER_FILE` for test isolation
- Attempt numbering uses max existing `.attempt<N>` suffix in trash, not file count, ensuring correct monotonic sequence across multi-file attempts
- Branch rename failure is non-fatal: warnings printed but restage proceeds
- `findActiveState()` checks both `bridge/staged/` (for STAGED) and `bridge/queue/` (for IN_PROGRESS/QUEUED/PENDING/EVALUATING)
