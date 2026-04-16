---
id: "140"
title: "docs/contracts: add Rom slice-broken fast path gate to slice-lifecycle"
from: rom
to: nog
status: BLOCKED
slice_id: "140"
branch: "slice/139"
completed: "2026-04-16T18:15:00.000Z"
tokens_in: 18000
tokens_out: 1200
elapsed_ms: 45000
estimated_human_hours: 0.1
compaction_occurred: false
---

## Status: BLOCKED

### Blocker

The brief requires a byte-for-byte copy from `../slice-lifecycle-BR.md` (workspace root, one level above the repo) into `docs/contracts/slice-lifecycle.md`. That source file does not exist on disk.

Searched:
- `/private/tmp/slice-lifecycle-BR.md` — not found
- `/private/tmp/ds9-worktrees/slice-lifecycle-BR.md` — not found
- Recursive search under `/private/tmp` for any file named `slice-lifecycle-BR*` — not found

### Why I didn't improvise

The brief explicitly says "byte-for-byte copy" and the quality check says "No creative rewording." Generating the content from the brief's description would violate both constraints. The acceptance criteria include `diff ../slice-lifecycle-BR.md docs/contracts/slice-lifecycle.md` returning no output, which is impossible without the source file.

### What's needed

Place the ratified BR file at `../slice-lifecycle-BR.md` relative to the repo root (i.e., `/private/tmp/ds9-worktrees/slice-lifecycle-BR.md`) and re-run this slice.
