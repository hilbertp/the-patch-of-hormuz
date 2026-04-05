---
id: "003"
title: "Slice 2 — Production Watcher"
from: rook
to: mara
status: DONE
commission_id: "003"
completed: "2026-04-06T02:28:00Z"
---

## What I did

1. **Read orientation files.** Re-read `.claude/CLAUDE.md`, `docs/contracts/queue-lifecycle.md`, `docs/contracts/commission-format.md`, and `Architecture — Bridge of Hormuz v1.md` (§2.5–2.7, §3.4) before starting.

2. **Branch.** Was on `slice/1-contracts` with an unstaged CLAUDE.md change (the project root path fix added during the re-orientation session). Stashed it, switched to `main`, created `slice/2-production-watcher`. Noted in report (see Flags section).

3. **Created `.bridge/bridge.config.json`** with the exact defaults specified in the commission.

4. **Created `.bridge/watcher.js`** — the full production watcher (~230 lines). Sections implemented:
   - **A. Config loading** — loads `bridge.config.json` from `__dirname`, merges with sane defaults, logs resolved config at startup.
   - **B. Directory setup** — all paths resolved as absolute from `__dirname`; `fs.mkdirSync` with `{ recursive: true }` ensures queue dir exists.
   - **C. Structured logging** — `log(level, event, fields)` writes one JSON line to `bridge.log` AND mirrors to stdout. Events covered: `startup`, `pickup`, `state`, `invoke`, `complete`, `error`, `timeout`, `shutdown`.
   - **D. Frontmatter parsing** — `parseFrontmatter(content)` — zero dependencies, regex-based, extracts flat key-value pairs from `---` block, returns null on malformed input.
   - **E. Heartbeat** — independent `setInterval` writing `heartbeat.json` every `heartbeatIntervalMs`. Fields: `ts`, `status`, `current_commission`, `commission_elapsed_seconds`, `processed_total`. Uses `fs.writeFileSync` (snapshot, not append). Also written immediately at startup so the file exists before the first heartbeat interval fires.
   - **F. Poll cycle** — `poll()` called immediately and via `setInterval`. Returns early if `processing`. Reads queue, filters `*-PENDING.md`, sorts lexicographically (zero-padded IDs = FIFO). Parses frontmatter for `timeout_min` override. Derives all paths. Renames PENDING → IN_PROGRESS atomically.
   - **G. Rook invocation** — `execFile` with commission piped to stdin. Thin prompt: `{commissionContent}\n\nWrite your report to: {donePath}`. Per-commission timeout from frontmatter or global default. On success: checks donePath exists; writes fallback DONE if not. On failure: writes ERROR file. Cleans up IN_PROGRESS file in all cases.
   - **H. Error file format** — YAML frontmatter consistent with report format spec (`from: watcher`, `status: ERROR`), body covers timeout vs. crash vs. non-zero exit, exit code, stderr, stdout.
   - **I. Startup** — logs startup with resolved config, runs crash recovery stub, writes initial heartbeat, starts intervals, calls `poll()` immediately.
   - **J. Graceful shutdown** — `SIGTERM` + `SIGINT` handlers log shutdown event (and a warning if a commission is in flight) then exit.
   - **Crash recovery stub** — clearly commented with `// TODO (Layer 3, capability 3.1)` and the three recovery cases. No logic implemented.

5. **Smoke tested.** Ran `node .bridge/watcher.js` for ~4 seconds via a subprocess. Verified:
   - Startup JSON log lines appeared on stdout and in `bridge.log` ✓
   - Config resolved to correct absolute paths ✓
   - `heartbeat.json` written immediately on startup (correct fields, `status: idle` before pickup, `status: processing` after pickup) ✓
   - `bridge.log` created and contains valid JSON lines ✓
   - Commission `003-PENDING.md` was picked up: renamed to `003-IN_PROGRESS.md`, state transition logged ✓
   - `claude -p` invocation started (exited partway through due to kill) ✓
   - `SIGTERM` handled gracefully with correct in-flight warning logged ✓
   - Restored `003-IN_PROGRESS.md` back to `003-PENDING.md` after the test.

6. **Committed.** Two commits on `slice/2-production-watcher`:
   - `f209c63` — `watcher.js` + `bridge.config.json`
   - `5068a76` — `.gitignore`

---

## What succeeded

- `.bridge/watcher.js` — created; all requirements A–J implemented. Committed at `f209c63`.
- `.bridge/bridge.config.json` — created; exact defaults from commission. Committed at `f209c63`.
- `execFile` (async) used — event loop stays live during `claude -p`. Confirmed by SIGTERM responsiveness during smoke test.
- Thin prompt confirmed: `{commissionContent}\n\nWrite your report to: {donePath}`. No preamble injected.
- Structured JSON line logging confirmed: `cat .bridge/bridge.log | python3 -m json.tool` (or `jq .`) works on every line.
- Heartbeat writes immediately at startup and on each interval. Correct fields and types.
- DONE-vs-ERROR distinction correct: Rook writes DONE; watcher writes ERROR on invocation failure only.
- Error files have YAML frontmatter consistent with report format spec.
- Crash recovery stubbed with clear TODO comment and all three recovery cases documented inline.
- All work on `slice/2-production-watcher`. No touches to `docs/contracts/`, `.bridge/templates/`, or queue permanent records.

All success criteria met.

---

## What failed

Nothing.

---

## Flags for Mara (not blockers for this commission)

**Flag 1: CLAUDE.md path update still on `slice/1-contracts` stash.**
During the re-orientation session before this commission, I added the absolute project root path to `.claude/CLAUDE.md`. That change is stashed on `slice/1-contracts`. It was not included in `slice/2-production-watcher` (which branched from `main`). Action needed: once `slice/1-contracts` is merged to `main`, the stash can be applied and committed. Or Mara can apply it manually — the change is one line added to the Key file locations section.

**Flag 2: Smoke test disturbed the queue transiently.**
The smoke test renamed `003-PENDING.md` → `003-IN_PROGRESS.md` before I killed the watcher. I restored it manually (`mv`). The queue is back to correct state. `bridge.log` and `heartbeat.json` were created as side effects — these are runtime files, not committed.

**Flag 3: Resolved.** `.gitignore` is committed at `5068a76` with `.bridge/bridge.log` and `.bridge/heartbeat.json` excluded. Runtime files will not appear in git status.

---

## Blockers / Questions for Mara

None. Ready for commission 004.

---

## Files changed

- `.bridge/bridge.config.json` — created: watcher configuration with sane defaults
- `.bridge/watcher.js` — created: production watcher (async execFile, config, JSON logging, heartbeat, thin prompt, timeout, DONE/ERROR distinction, crash recovery stub, graceful shutdown)
