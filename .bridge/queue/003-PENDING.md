---
id: "003"
title: "Slice 2 — Production Watcher"
from: mara
to: rook
priority: normal
created: "2026-04-06T00:00:00Z"
references: "002"
timeout_min: null
---

## Objective

Rewrite `.bridge/watcher.js` — the production Node.js process that watches the queue directory, invokes Rook via `claude -p`, and writes DONE/ERROR reports. Replace the spike watcher with an async, config-driven, logging, heartbeat-emitting implementation. This makes the bridge autonomous: Philipp no longer triggers Rook manually.

---

## Context

Slice 1 (commission 002) is ACCEPTED. Contracts and templates are in place.

**Where we are:**

- The spike watcher lives at the OLD path (`/Users/phillyvanilly/The Spiderverse/Hormuz/.bridge/watcher.js`) — outside the repo. Do not touch it.
- The repo at `/Users/phillyvanilly/The Spiderverse/Hormuz/The Patch of Hormuz/` has no `watcher.js` yet. That is what you are building.
- The repo's `.bridge/` directory currently contains: `queue/` (with 002-DONE.md and .gitkeep), `templates/` (commission.md, report.md). The `bridge.config.json`, `bridge.log`, and `heartbeat.json` files do not exist yet — you will create the config file; the log and heartbeat will be created at runtime.

**Key files to read before starting:**

- `.claude/CLAUDE.md` — your project anchor (you've already read it, but re-read if context is fresh)
- `docs/contracts/queue-lifecycle.md` — state machine you must implement
- `docs/contracts/commission-format.md` — frontmatter structure you'll parse
- `Architecture — Bridge of Hormuz v1.md` (at the PARENT dir, one level up from project root: `/Users/phillyvanilly/The Spiderverse/Hormuz/Architecture — Bridge of Hormuz v1.md`) — sections 2.5, 2.6, 2.7, 3.4 are the watcher design

**Architecture decisions locked by Soren (do not deviate):**

- `execFile` (async), NOT `execSync` — event loop must stay live during `claude -p`
- Zero external dependencies — Node built-ins only (`fs`, `path`, `child_process`)
- Config from `bridge.config.json` — defaults are sane (watcher works with zero configuration)
- JSON lines logging — append to `bridge.log`, mirror to stdout
- Heartbeat — write `heartbeat.json` every 60s on an independent interval
- Thin prompt — commission content + report path ONLY, no preamble, no role injection
- 15-minute default timeout (900000ms) — a dead-man's switch, not a work cap

---

## Tasks

### Branch setup

1. **Verify you are on `main`** (or the right base). Run `git status` and `git branch`. If there is uncommitted Slice 1 work pending merge, note it in your report but do not block — Slice 2 goes on its own branch regardless.

2. **Create branch `slice/2-production-watcher`** from `main`.

### Create `bridge.config.json`

3. **Create `.bridge/bridge.config.json`** with these defaults:

   ```json
   {
     "pollIntervalMs": 5000,
     "timeoutMs": 900000,
     "heartbeatIntervalMs": 60000,
     "queueDir": "queue",
     "logFile": "bridge.log",
     "heartbeatFile": "heartbeat.json",
     "claudeCommand": "claude",
     "claudeArgs": ["-p", "--permission-mode", "bypassPermissions"],
     "projectDir": "..",
     "maxRetries": 0
   }
   ```

   All paths in `queueDir`, `logFile`, `heartbeatFile` are relative to `.bridge/` (the directory containing `watcher.js`). `projectDir` is relative to `.bridge/` and points to the project root.

### Write `watcher.js`

4. **Create `.bridge/watcher.js`** — the full production watcher. Requirements, in order:

   **A. Config loading**
   - Load `bridge.config.json` from the same directory as `watcher.js` (`__dirname`)
   - Merge with sane defaults so the watcher works with zero configuration
   - Log the resolved config at startup

   **B. Directory setup**
   - Resolve `queueDir`, `logFile`, `heartbeatFile` as absolute paths relative to `__dirname`
   - Resolve `projectDir` as absolute path relative to `__dirname`
   - Ensure queue directory exists (`fs.mkdirSync` with `{ recursive: true }`)

   **C. Structured logging**
   - A `log(level, event, fields)` function that writes one JSON line to `bridge.log` AND mirrors to stdout
   - Each log line: `{ ts, level, event, ...fields }` where `ts` is ISO 8601
   - Events to log: `startup`, `pickup`, `state`, `invoke`, `complete`, `error`, `timeout`, `heartbeat` (heartbeat optional — too noisy; log startup and state changes instead)
   - Log levels: `info`, `warn`, `error`

   **D. Frontmatter parsing**
   - A `parseFrontmatter(content)` function — zero dependencies, regex-based
   - Extracts flat key-value pairs from the `---` block
   - Returns `null` if frontmatter is missing or malformed
   - Used to extract `id` (for logging) and `timeout_min` (for per-commission timeout override)

   **E. Heartbeat**
   - An independent `setInterval` that writes `heartbeat.json` every `heartbeatIntervalMs`
   - Heartbeat fields: `{ ts, status, current_commission, commission_elapsed_seconds, processed_total }`
   - `status` is `"idle"` or `"processing"`
   - `current_commission` is `null` when idle, the ID string when processing
   - `commission_elapsed_seconds` is `null` when idle, elapsed seconds since pickup when processing
   - `processed_total` increments on each completed commission (DONE or ERROR — not re-queues)
   - Use `fs.writeFileSync` (not append) — heartbeat is always the current snapshot

   **F. Poll cycle**
   - A `poll()` function that runs every `pollIntervalMs` via `setInterval` (also called once immediately on startup)
   - Returns early if `processing` is true (one commission at a time)
   - Reads queue directory, filters for `*-PENDING.md`, sorts by filename (lowest ID first — FIFO)
   - If no PENDING files, returns
   - Picks the first PENDING file
   - Parses frontmatter to get `id` and `timeout_min`
   - Derives all paths: `inProgressPath`, `donePath`, `errorPath`
   - Renames PENDING → IN_PROGRESS via `fs.renameSync` (atomic)
   - Logs the state transition
   - Sets `processing = true`, records pickup timestamp, updates heartbeat state
   - Invokes `claude -p` (see G)
   - On completion (success or failure), sets `processing = false`, increments `processed_total`
   - Logs the outcome

   **G. Rook invocation**
   - Use `execFile` (from `child_process`) with the commission piped to stdin
   - Command: `config.claudeCommand` with args `config.claudeArgs`
   - Options: `{ cwd: projectDir, encoding: 'utf-8', timeout: effectiveTimeoutMs }`
   - `effectiveTimeoutMs` = `timeout_min` from frontmatter (converted to ms) if present, otherwise `config.timeoutMs`
   - **Prompt (thin):** commission file content + one mechanical instruction:
     ```
     {commissionContent}

     Write your report to: {donePath}
     ```
     No system preamble. No role description. No project history. Pure transport.
   - On success: check if `donePath` exists. If yes, log completion. If no, write a fallback DONE report (raw stdout) — Rook should always write his own, but this is a safety net.
   - On failure (non-zero exit, timeout): write an ERROR file to `errorPath` with exit code, stderr, stdout, and whether it was a timeout
   - After writing DONE or ERROR: delete the IN_PROGRESS file via `fs.unlinkSync`

   **H. Error file format**
   - `{id}-ERROR.md` should have YAML frontmatter consistent with the report format spec
   - Required fields: `id`, `title`, `from: watcher`, `to: mara`, `status: ERROR`, `commission_id`, `completed`
   - Body: what failed (timeout vs. crash vs. non-zero exit), exit code, stderr, stdout

   **I. Startup**
   - Log startup event with resolved config summary
   - Note: crash recovery (orphaned IN_PROGRESS handling) is a Layer 3 capability (3.1) — implement it as a stub with a clear TODO comment but do NOT implement the logic in this slice
   - Start heartbeat interval
   - Start poll interval
   - Call `poll()` immediately

   **J. Graceful shutdown**
   - Handle `SIGTERM` and `SIGINT`: log shutdown event, then exit
   - If a commission is in flight when shutdown is received, log a warning (but don't try to kill it — the process exits and the IN_PROGRESS file will be handled by crash recovery in Layer 3)

### Verify locally

5. **Smoke test:** Start the watcher (`node .bridge/watcher.js`) and verify:
   - Startup logs appear
   - `heartbeat.json` is written within 60s (or you can reduce the interval temporarily and restore — note it in your report)
   - With an existing PENDING file in the queue, the watcher picks it up and transitions it
   - `bridge.log` is created and contains JSON lines

   If you cannot run a live test without disturbing the queue, do a code review pass instead and note it in your report.

### Commit

6. **Commit on `slice/2-production-watcher`** with message: `feat(slice-2): production watcher with async execution, config, logging, heartbeat`

   Note: `.gitignore` already exists at the project root (committed on `main` by Mara). Do not recreate it.

---

## Constraints

- Do not touch `docs/contracts/` or `.bridge/templates/` — those are Slice 1 artifacts
- Do not touch `.bridge/queue/001-DONE.md` or `.bridge/queue/002-DONE.md` — permanent records
- Do not modify `PRD — Bridge of Hormuz v2.md`, `Capability Map — Bridge of Hormuz.md`, or `Architecture — Bridge of Hormuz v1.md` — those are planning documents
- Zero external dependencies. If `require('something')` isn't a Node built-in, don't use it
- No `package.json` unless you have a specific reason — document the reason if so
- Crash recovery (3.1) is explicitly out of scope — stub only, no implementation

---

## Success criteria

Mara will evaluate this report as ACCEPTED when:

1. `.bridge/watcher.js` exists in the repo and implements all requirements above (async execFile, config, logging, heartbeat, thin prompt, timeout, DONE/ERROR distinction)
2. `.bridge/bridge.config.json` exists with the correct defaults
3. The watcher uses `execFile` (not `execSync`) — event loop stays live
4. The prompt piped to `claude -p` is thin: commission content + report path, nothing else
5. Structured JSON line logging is implemented (`log()` function, `bridge.log` target, stdout mirror)
6. Heartbeat is implemented (writes `heartbeat.json` every 60s, correct fields)
7. DONE-vs-ERROR distinction is correct: Rook writes DONE; watcher writes ERROR on invocation failure
8. Error files have YAML frontmatter consistent with the report format spec
9. Crash recovery is stubbed (comment-only, no logic) with a clear Layer 3 TODO
10. `.gitignore` exists at project root with `.DS_Store`, runtime artifacts, and `node_modules/` excluded
11. All work is committed on `slice/2-production-watcher`
12. Your report is written to `.bridge/queue/003-DONE.md`
