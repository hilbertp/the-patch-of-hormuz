---
id: "054"
title: "Bulletproof per-slice tracking — tokens, time, human hours"
summary: "Wire per-slice token, time, and human hours tracking into the watcher. Fix null tokens at root cause. Enforce metrics as a hard gate on every commission. Append to slicelog.jsonl automatically."
goal: "Every commission produces a slicelog.jsonl row with real token counts, elapsed time, human hours estimate, and compaction flag. Missing metrics stall the pipeline visibly. No role needs to remember anything."
from: kira
to: obrien
priority: high
created: "2026-04-12T00:00:00Z"
references: "dax-adr:BET3-PER-SLICE-TRACKING"
expected_human_hours: 2.5
timeout_min: null
status: "PENDING"
---

## Read first

Before touching any code, read both of these in full:
- `docs/architecture/BET3-PER-SLICE-TRACKING.md` — Dax's ADR, the authoritative spec
- `repo/.claude/roles/obrien/HANDOFF-BET3-SLICE-TRACKING-FROM-DAX.md` — your architecture brief

All seven changes below come directly from that ADR. Do not improvise.

---

## Change 1 — Fix null tokens at root cause

In `bridge/bridge.config.json`, add `--output-format json` to `claudeArgs`:

```json
"claudeArgs": ["-p", "--output-format", "json", "--permission-mode", "bypassPermissions"]
```

**After making this change, verify stdout parsing still works.** The watcher's `invokeOBrien` parses claude's stdout — confirm it handles JSON-wrapped output correctly. This is the one risk worth checking before merge.

---

## Change 2 — DONE report template: add 5 required fields

The commission prompt instructs you to write a DONE report. Add these five fields to the frontmatter section of every DONE report you write from this commission forward:

```yaml
tokens_in: 0
tokens_out: 0
elapsed_ms: 0
estimated_human_hours: 0.0
compaction_occurred: false
```

Fill them with real values:
- `tokens_in` / `tokens_out` — from your session usage (available via `claude -p --output-format json`)
- `elapsed_ms` — wall-clock ms from when you picked up the commission to when you write DONE
- `estimated_human_hours` — your honest judgment: how long would a skilled human developer take for equivalent work? Weight higher if compaction occurred.
- `compaction_occurred` — true if your context window filled and compacted mid-session

---

## Change 3 — Metrics validation gate in DONE handler

In `watcher.js`, in the DONE handler (~line 572, after confirming the DONE file exists):

Parse the DONE file frontmatter and validate all five fields are present and well-typed:
- `tokens_in` — non-negative integer
- `tokens_out` — non-negative integer
- `elapsed_ms` — positive integer
- `estimated_human_hours` — positive number
- `compaction_occurred` — boolean

If any field is missing or malformed: write an ERROR file with `reason: "incomplete_metrics"`, log the failure, do not proceed to evaluation. Silent omission is the failure mode this fixes.

---

## Change 4 — `appendSliceLog(entry)` function

Write a small reusable function in `watcher.js` (or extract to `bridge/slicelog.js`) that appends a JSON line to `bridge/slicelog.jsonl`. Takes an entry object, JSON-stringifies it, appends with newline. This function is called from two places and will later be called from the Ruflo runner.

---

## Change 5 — Write Point 1: append row at DONE

Immediately after validation passes, call `appendSliceLog()` with the full schema (see ADR section 3 for exact field list). Key fields:
- `runtime: "legacy"` — hardcoded for now; Ruflo path will pass `"ruflo"`
- `result: null` — not yet known
- `expected_human_hours` — read from commission frontmatter if present, else null

---

## Change 6 — Write Point 2: update row at terminal state

In `handleAccepted`, `handleStuck`, and error closure paths: after the terminal event fires, find the slicelog row by `id` and update `result`, `cycle`, `ts_result`. Full file rewrite is acceptable — file is small.

If the entry doesn't exist (watcher restarted mid-flight): create it with available data and `"recovered": true`.

---

## Change 7 — README update

Add two missing entries to the project structure section in `README.md`:
- `bridge/staged/` — staging area for Philipp's commission review (the Rubicon)
- `bridge/register.jsonl` — append-only event log

---

## Success Criteria

- [ ] `bridge/bridge.config.json` contains `--output-format json` in `claudeArgs`
- [ ] Token extraction from JSON output verified working (not null)
- [ ] Every DONE report includes all 5 metrics fields, filled with real values
- [ ] Missing or malformed metrics field produces ERROR with `reason: "incomplete_metrics"`
- [ ] `bridge/slicelog.jsonl` is created and receives one row per commission
- [ ] Row is updated at terminal state (ACCEPTED / STUCK / ERROR)
- [ ] `appendSliceLog()` is a reusable function callable from future Ruflo path
- [ ] README updated with staged/ and register.jsonl entries
- [ ] No regression in existing watcher behavior
