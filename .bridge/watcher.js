'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEFAULTS = {
  pollIntervalMs: 5000,
  timeoutMs: 900000,
  heartbeatIntervalMs: 60000,
  queueDir: 'queue',
  logFile: 'bridge.log',
  heartbeatFile: 'heartbeat.json',
  claudeCommand: 'claude',
  claudeArgs: ['-p', '--permission-mode', 'bypassPermissions', '--output-format', 'json'],
  projectDir: '..',
  maxRetries: 0,
};

function loadConfig() {
  const configPath = path.join(__dirname, 'bridge.config.json');
  let fileConfig = {};
  try {
    fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch (_) {
    // Config file absent or unreadable — proceed with defaults.
    // This is intentional: the watcher must work with zero configuration.
  }
  return Object.assign({}, DEFAULTS, fileConfig);
}

const config = loadConfig();

// ---------------------------------------------------------------------------
// Resolved paths
// ---------------------------------------------------------------------------

const QUEUE_DIR      = path.resolve(__dirname, config.queueDir);
const LOG_FILE       = path.resolve(__dirname, config.logFile);
const HEARTBEAT_FILE = path.resolve(__dirname, config.heartbeatFile);
const PROJECT_DIR    = path.resolve(__dirname, config.projectDir);

// Ensure queue directory exists.
fs.mkdirSync(QUEUE_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Terminal presentation
// ---------------------------------------------------------------------------

// Honor NO_COLOR env var: checked once at startup.
const USE_COLOR = !process.env.NO_COLOR;

// ANSI color codes — empty strings when color is disabled.
const C = {
  green:  USE_COLOR ? '\x1b[32m' : '',
  red:    USE_COLOR ? '\x1b[31m' : '',
  yellow: USE_COLOR ? '\x1b[33m' : '',
  cyan:   USE_COLOR ? '\x1b[36m' : '',
  dim:    USE_COLOR ? '\x1b[2m'  : '',
  reset:  USE_COLOR ? '\x1b[0m'  : '',
};

// Box-drawing characters: Unicode when colors are on, ASCII fallback for NO_COLOR.
const B = {
  dbl:  USE_COLOR ? '\u2550' : '=',  // ═
  sng:  USE_COLOR ? '\u2500' : '-',  // ─
  vert: USE_COLOR ? '\u2502' : '|',  // │
  tl:   USE_COLOR ? '\u250C' : '+',  // ┌
  bl:   USE_COLOR ? '\u2514' : '+',  // └
};

// Symbols: Unicode or ASCII equivalents.
const SYM = {
  check: USE_COLOR ? '\u2713'  : 'OK',   // ✓
  cross: USE_COLOR ? '\u2717'  : 'X',    // ✗
  clock: USE_COLOR ? '\u23F3'  : '...',  // ⏳
  right: USE_COLOR ? '\u25BA'  : '>',    // ►
  back:  USE_COLOR ? '\u21A9'  : '<-',   // ↩
  clip:  USE_COLOR ? '\uD83D\uDCCB ' : '',  // 📋 (with trailing space)
  sep:   USE_COLOR ? ' \u00B7 ' : ' - ', // ' · '
  dash:  USE_COLOR ? ' \u2014 ' : ' - ', // ' — '
  arrow: USE_COLOR ? ' \u2192 ' : ' -> ', // ' → '
  dots:  USE_COLOR ? '\u2026'  : '...',  // …
};

const W = 65; // Box width

function hLine(char) { return char.repeat(W); }

function print(s) { process.stdout.write(s + '\n'); }

// ---------------------------------------------------------------------------
// Timestamps and formatting
// ---------------------------------------------------------------------------

function timestampNow() {
  const now = new Date();
  return [now.getHours(), now.getMinutes(), now.getSeconds()]
    .map(n => String(n).padStart(2, '0'))
    .join(':');
}

function formatDuration(ms) {
  const totalSec = Math.floor(ms / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

// ---------------------------------------------------------------------------
// Token / cost tracking (Task 2)
// ---------------------------------------------------------------------------

const INPUT_COST_PER_M  = 15.00; // $ per 1M input tokens
const OUTPUT_COST_PER_M = 75.00; // $ per 1M output tokens

/**
 * extractTokenUsage(stdout)
 *
 * Parses Claude Code's --output-format json output and extracts token counts.
 * Falls back gracefully to nulls if the output is not valid JSON or the
 * expected fields are absent (e.g. older Claude Code version).
 */
function extractTokenUsage(stdout) {
  try {
    const data = JSON.parse(stdout.trim());
    const usage = data.usage || {};
    const tokensIn  = typeof usage.input_tokens  === 'number' ? usage.input_tokens  : null;
    const tokensOut = typeof usage.output_tokens === 'number' ? usage.output_tokens : null;
    return { tokensIn, tokensOut };
  } catch (_) {
    return { tokensIn: null, tokensOut: null };
  }
}

function computeCost(tokensIn, tokensOut) {
  if (tokensIn == null || tokensOut == null) return null;
  return (tokensIn  * INPUT_COST_PER_M  / 1_000_000)
       + (tokensOut * OUTPUT_COST_PER_M / 1_000_000);
}

function formatTokens(tokensIn, tokensOut) {
  if (tokensIn == null || tokensOut == null) return 'tokens: unknown';
  return `${(tokensIn + tokensOut).toLocaleString()} tokens`;
}

function formatCost(costUsd) {
  if (costUsd == null) return '';
  return `$${costUsd.toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Session state (Task 5)
// ---------------------------------------------------------------------------

const session = {
  startTime:  Date.now(),
  completed:  0,
  failed:     0,
  tokensIn:   0,
  tokensOut:  0,
  costUsd:    0,
  hasTokens:  false, // true once we've seen at least one real token count
};

function recordSessionResult(success, tokensIn, tokensOut, costUsd) {
  if (success) session.completed += 1; else session.failed += 1;
  if (tokensIn  != null) { session.tokensIn  += tokensIn;  session.hasTokens = true; }
  if (tokensOut != null) { session.tokensOut += tokensOut; session.hasTokens = true; }
  if (costUsd   != null) { session.costUsd   += costUsd; }
}

function printSessionSummary() {
  const uptimeMins = Math.floor((Date.now() - session.startTime) / 60000);
  const uptimeStr  = uptimeMins > 0 ? `${uptimeMins}m` : '<1m';
  const tokenStr   = session.hasTokens
    ? `${(session.tokensIn + session.tokensOut).toLocaleString()} tokens`
    : 'tokens: unknown';
  const costStr    = session.hasTokens ? `${SYM.sep}${formatCost(session.costUsd)}` : '';
  print(`  Session: ${session.completed} completed${SYM.sep}${session.failed} failed${SYM.sep}${tokenStr}${costStr}${SYM.sep}uptime ${uptimeStr}`);
  print('');
}

// ---------------------------------------------------------------------------
// Queue snapshot (Task 4)
// ---------------------------------------------------------------------------

/**
 * getQueueSnapshot(queueDir)
 *
 * Scans the queue directory and returns counts by file state suffix.
 * awaiting_review == completed (all DONE files) in v1 — no ACCEPTED state yet.
 */
function getQueueSnapshot(queueDir) {
  let files;
  try {
    files = fs.readdirSync(queueDir);
  } catch (_) {
    return { waiting: 0, in_progress: 0, completed: 0, failed: 0, awaiting_review: 0 };
  }
  const waiting     = files.filter(f => f.endsWith('-PENDING.md')).length;
  const in_progress = files.filter(f => f.endsWith('-IN_PROGRESS.md')).length;
  const completed   = files.filter(f => f.endsWith('-DONE.md')).length;
  const failed      = files.filter(f => f.endsWith('-ERROR.md')).length;
  return { waiting, in_progress, completed, failed, awaiting_review: completed };
}

// ---------------------------------------------------------------------------
// Startup block (Task 3)
// ---------------------------------------------------------------------------

/**
 * printStartupBlock(recoveryActions)
 *
 * Prints the full startup UI block — header, recovery section (if any),
 * and queue snapshot. Called once on launch after crashRecovery() runs.
 */
function printStartupBlock(recoveryActions) {
  const ts         = timestampNow();
  const pollSec    = Math.round(config.pollIntervalMs / 1000);
  const timeoutMin = Math.round(config.timeoutMs / 60000);

  print('');
  print(hLine(B.dbl));
  print(`  Bridge of Hormuz${SYM.sep}Watcher`);
  print(`  Started: ${ts}${SYM.sep}Polling every ${pollSec}s${SYM.sep}Timeout: ${timeoutMin}min`);
  print(hLine(B.dbl));

  if (recoveryActions.length > 0) {
    print('');
    print('  Recovered on startup:');
    for (const action of recoveryActions) {
      if (action.type === 'cleared') {
        print(`    ${C.green}${SYM.check}${C.reset} Commission ${action.id}${SYM.dash}cleared stale work-in-progress (already completed)`);
      } else if (action.type === 'cleared_error') {
        print(`    ${C.yellow}${SYM.check}${C.reset} Commission ${action.id}${SYM.dash}cleared stale work-in-progress (already failed)`);
      } else if (action.type === 'requeued') {
        print(`    ${C.yellow}${SYM.back}${C.reset} Commission ${action.id}${SYM.dash}re-queued interrupted commission`);
      }
    }
  }

  const snapshot = getQueueSnapshot(QUEUE_DIR);
  print('');
  print('  Queue snapshot:');
  const isEmpty = snapshot.waiting === 0 && snapshot.in_progress === 0
               && snapshot.completed === 0 && snapshot.failed === 0;
  if (isEmpty) {
    print(`    Queue is empty${SYM.dash}watching for new commissions.`);
  } else {
    print(`    ${SYM.clip}${snapshot.waiting} waiting${SYM.sep}${snapshot.in_progress} in progress${SYM.sep}${snapshot.completed} completed${SYM.sep}${snapshot.failed} failed`);
  }
  print(hLine(B.sng));
  print('');
}

// ---------------------------------------------------------------------------
// Commission lifecycle blocks (Task 3)
// ---------------------------------------------------------------------------

/**
 * openCommissionBlock(id, title)
 *
 * Prints the opening of a commission lifecycle block. Called at pickup.
 */
function openCommissionBlock(id, title) {
  const titleStr = title ? `${SYM.sep}"${title}"` : '';
  print(`${B.tl}${B.sng.repeat(W - 1)}`);
  print(`${B.vert}  ${SYM.right} Commission ${id}${titleStr}`);
  print(`${B.vert}    Queued${SYM.arrow}Handed off to Rook`);
  print(`${B.vert}`);
}

/**
 * printProgressTick(elapsedMs)
 *
 * Appends a progress line inside the open commission block. Called every 60s.
 */
function printProgressTick(elapsedMs) {
  const elapsed = formatDuration(elapsedMs);
  print(`${B.vert}    ${C.yellow}${SYM.clock}${C.reset} Working${SYM.dots} ${elapsed}`);
}

/**
 * closeCommissionBlock(success, durationMs, tokensIn, tokensOut, costUsd, reason)
 *
 * Prints the completion or failure lines and closes the commission block.
 */
function closeCommissionBlock(success, durationMs, tokensIn, tokensOut, costUsd, reason) {
  const duration  = formatDuration(durationMs);
  const tokenStr  = formatTokens(tokensIn, tokensOut);
  const costStr   = formatCost(costUsd);

  if (success) {
    const parts = [duration, tokenStr];
    if (costStr) parts.push(costStr);
    print(`${B.vert}    ${C.green}${SYM.check}${C.reset} Complete${SYM.sep}${parts.join(SYM.sep)}`);
    print(`${B.vert}    Status: Done${SYM.arrow}Waiting for Mara's review`);
  } else {
    const reasonStr = reason || 'Unknown error';
    print(`${B.vert}    ${C.red}${SYM.cross}${C.reset} Failed${SYM.sep}${duration}${SYM.sep}Reason: ${reasonStr}`);
    print(`${B.vert}    Status: Needs attention`);
  }
  print(`${B.bl}${B.sng.repeat(W - 1)}`);
  print('');
}

// ---------------------------------------------------------------------------
// Structured logging (bridge.log only — stdout handled by presentation layer)
// ---------------------------------------------------------------------------

/**
 * log(level, event, fields)
 *
 * Writes one JSON line to bridge.log. Does NOT write to stdout — all terminal
 * output is handled by the presentation functions above.
 */
function log(level, event, fields) {
  const line = JSON.stringify(Object.assign({ ts: new Date().toISOString(), level, event }, fields));
  try {
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch (err) {
    // Log file write failure must not crash the watcher.
    process.stdout.write('[log-write-error] ' + err.message + '\n');
  }
}

// ---------------------------------------------------------------------------
// Frontmatter parsing
// ---------------------------------------------------------------------------

/**
 * parseFrontmatter(content)
 *
 * Zero-dependency, regex-based YAML frontmatter extractor.
 * Returns a flat key→value object, or null if frontmatter is absent/malformed.
 * Values are stripped of surrounding quotes.
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const meta = {};
  match[1].split('\n').forEach(line => {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) return;
    const key = line.slice(0, colonIdx).trim();
    const val = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (key) meta[key] = val;
  });
  return meta;
}

// ---------------------------------------------------------------------------
// Heartbeat
// ---------------------------------------------------------------------------

let heartbeatState = {
  status: 'idle',
  current_commission: null,
  pickupTime: null,   // internal — not written to file
  processed_total: 0,
};

function writeHeartbeat() {
  const elapsedSeconds = heartbeatState.pickupTime
    ? Math.floor((Date.now() - heartbeatState.pickupTime) / 1000)
    : null;

  const snapshot = {
    ts: new Date().toISOString(),
    status: heartbeatState.status,
    current_commission: heartbeatState.current_commission,
    commission_elapsed_seconds: elapsedSeconds,
    processed_total: heartbeatState.processed_total,
  };

  try {
    fs.writeFileSync(HEARTBEAT_FILE, JSON.stringify(snapshot, null, 2) + '\n');
  } catch (err) {
    log('warn', 'heartbeat', { msg: 'Failed to write heartbeat', error: err.message });
  }
}

// ---------------------------------------------------------------------------
// Processing state
// ---------------------------------------------------------------------------

let processing = false;

// ---------------------------------------------------------------------------
// Rook invocation
// ---------------------------------------------------------------------------

/**
 * invokeRook(commissionContent, donePath, inProgressPath, errorPath, id, effectiveTimeoutMs)
 *
 * Pipes commission content + report path instruction to `claude -p`.
 * On success: checks donePath exists; if not, writes a fallback ERROR report.
 * On failure: writes an ERROR report.
 * Always cleans up the IN_PROGRESS file on completion (existence-checked to
 * avoid ENOENT when Rook's crash recovery already handled it).
 */
function invokeRook(commissionContent, donePath, inProgressPath, errorPath, id, effectiveTimeoutMs) {
  const prompt = commissionContent + '\n\nWrite your report to: ' + donePath;

  const pickupTime = Date.now();
  heartbeatState.status = 'processing';
  heartbeatState.current_commission = id;
  heartbeatState.pickupTime = pickupTime;
  writeHeartbeat();

  log('info', 'invoke', {
    id,
    msg: 'Invoking claude -p',
    command: config.claudeCommand,
    args: config.claudeArgs,
    cwd: PROJECT_DIR,
    timeoutMs: effectiveTimeoutMs,
  });

  // Progress tick: every 60s while Rook is running — stdout only, not bridge.log.
  const tickInterval = setInterval(() => {
    printProgressTick(Date.now() - pickupTime);
  }, 60000);

  const child = execFile(
    config.claudeCommand,
    config.claudeArgs,
    {
      cwd: PROJECT_DIR,
      encoding: 'utf-8',
      timeout: effectiveTimeoutMs,
      maxBuffer: 10 * 1024 * 1024, // 10 MB stdout buffer
    },
    (err, stdout, stderr) => {
      clearInterval(tickInterval);

      const durationMs = Date.now() - pickupTime;
      const isTimeout  = err && err.killed && err.signal === 'SIGTERM';

      // Extract token usage from JSON output (Task 2).
      // Falls back gracefully to nulls if output is not parseable JSON.
      const { tokensIn, tokensOut } = extractTokenUsage(stdout || '');
      const costUsd = computeCost(tokensIn, tokensOut);

      if (!err) {
        // Success path: check Rook wrote his DONE file.
        if (fs.existsSync(donePath)) {
          log('info', 'complete', { id, msg: 'Rook finished — DONE file present', durationMs, tokensIn, tokensOut });
          log('info', 'state', { id, from: 'IN_PROGRESS', to: 'DONE' });
          closeCommissionBlock(true, durationMs, tokensIn, tokensOut, costUsd, null);
          recordSessionResult(true, tokensIn, tokensOut, costUsd);
        } else {
          // Rook exited 0 but wrote no DONE file — write an ERROR report with reason "no_report".
          log('warn', 'complete', {
            id,
            msg: 'Rook exited cleanly but wrote no DONE file — writing ERROR (no_report)',
            reason: 'no_report',
            durationMs,
          });
          writeErrorFile(errorPath, id, 'no_report', null, stdout, stderr);
          log('info', 'state', { id, from: 'IN_PROGRESS', to: 'ERROR', reason: 'no_report' });
          closeCommissionBlock(false, durationMs, tokensIn, tokensOut, costUsd, 'No report written');
          recordSessionResult(false, tokensIn, tokensOut, costUsd);
        }
      } else {
        // Failure path: distinguish timeout vs non-zero exit.
        const reason = isTimeout ? 'timeout' : 'crash';
        log('error', isTimeout ? 'timeout' : 'error', {
          id,
          msg: isTimeout ? 'Commission timed out' : 'claude -p failed',
          reason,
          exitCode: err.code,
          signal: err.signal || null,
          durationMs,
        });
        writeErrorFile(errorPath, id, reason, err, stdout, stderr);
        log('info', 'state', { id, from: 'IN_PROGRESS', to: 'ERROR', reason });
        const reasonDisplay = isTimeout ? 'Timed out' : 'Process failed';
        closeCommissionBlock(false, durationMs, tokensIn, tokensOut, costUsd, reasonDisplay);
        recordSessionResult(false, tokensIn, tokensOut, costUsd);
      }

      printSessionSummary();

      // Task 1: ENOENT fix — check existence before unlinking.
      // Rook's crash recovery may have already renamed or deleted this file.
      if (fs.existsSync(inProgressPath)) {
        try {
          fs.unlinkSync(inProgressPath);
        } catch (unlinkErr) {
          log('warn', 'error', { id, msg: 'Failed to delete IN_PROGRESS file', error: unlinkErr.message });
        }
      }

      // Reset processing state.
      processing = false;
      heartbeatState.status = 'idle';
      heartbeatState.current_commission = null;
      heartbeatState.pickupTime = null;
      heartbeatState.processed_total += 1;
      writeHeartbeat();
    }
  );

  // Feed the prompt to claude via stdin, then close stdin to signal EOF.
  child.stdin.write(prompt);
  child.stdin.end();
}

// ---------------------------------------------------------------------------
// ERROR file (written by watcher on invocation failure or invalid commission)
// ---------------------------------------------------------------------------

/**
 * writeErrorFile(errorPath, id, reason, err, stdout, stderr)
 *
 * Writes a structured ERROR report. The frontmatter always includes `reason`
 * so bridge.log and Mara's tooling can distinguish failure modes:
 *   "timeout"             — process was killed after exceeding the timeout
 *   "crash"               — process exited non-zero; exit_code included
 *   "no_report"           — process exited 0 but wrote no DONE file
 *   "invalid_commission"  — PENDING file failed frontmatter validation
 *
 * @param {string}      errorPath  Absolute path for the ERROR file.
 * @param {string}      id         Commission ID.
 * @param {string}      reason     One of the four reason strings above.
 * @param {Error|null}  err        The Error object (null for no_report/invalid).
 * @param {string}      stdout     Combined stdout captured from the process.
 * @param {string}      stderr     Combined stderr captured from the process.
 * @param {Object}      [extra]    Optional extra fields (e.g. { missingFields }).
 */
function writeErrorFile(errorPath, id, reason, err, stdout, stderr, extra) {
  const completed = new Date().toISOString();
  const exitCode  = err && err.code != null ? String(err.code) : null;
  const signal    = err && err.signal ? err.signal : null;

  const frontmatter = [
    '---',
    `id: "${id}"`,
    `title: "Commission ${id} — ${reason}"`,
    'from: watcher',
    'to: mara',
    'status: ERROR',
    `commission_id: "${id}"`,
    `completed: "${completed}"`,
    `reason: "${reason}"`,
  ];

  if (reason === 'crash' && exitCode !== null) {
    frontmatter.push(`exit_code: ${exitCode}`);
  }
  frontmatter.push('---');

  const truncate = (s, n) => (s && s.length > n ? '…' + s.slice(-n) : s || '(empty)');
  const stdoutBody = reason === 'no_report' ? truncate(stdout, 500) : (stdout || '(empty)');
  const stderrBody = reason === 'no_report' ? truncate(stderr, 500) : (stderr || '(empty)');

  const detail = reason === 'timeout'
    ? 'The process was killed after exceeding the configured timeout.'
    : reason === 'crash'
      ? `The process exited with a non-zero status (exit code ${exitCode ?? 'unknown'}).`
      : reason === 'no_report'
        ? 'The process exited cleanly but wrote no DONE file.'
        : `Commission frontmatter validation failed. Missing fields: ${(extra && extra.missingFields || []).join(', ')}.`;

  const content = [
    ...frontmatter,
    '',
    '## Failure reason',
    '',
    `**${reason}**`,
    '',
    detail,
    '',
    '## Invocation details',
    '',
    `- Exit code: ${exitCode ?? 'n/a'}`,
    `- Signal: ${signal ?? 'n/a'}`,
    `- Reason: ${reason}`,
    '',
    '## stderr',
    '',
    '```',
    stderrBody,
    '```',
    '',
    '## stdout',
    '',
    '```',
    stdoutBody,
    '```',
  ].join('\n');

  try {
    fs.writeFileSync(errorPath, content);
  } catch (writeErr) {
    log('error', 'error', { id, msg: 'Failed to write ERROR file', error: writeErr.message });
  }
}

// ---------------------------------------------------------------------------
// Poll cycle
// ---------------------------------------------------------------------------

function poll() {
  if (processing) return;

  let files;
  try {
    files = fs.readdirSync(QUEUE_DIR);
  } catch (err) {
    log('error', 'error', { msg: 'Failed to read queue directory', error: err.message });
    return;
  }

  const pendingFiles = files
    .filter(f => f.endsWith('-PENDING.md'))
    .sort(); // lexicographic = numeric FIFO given zero-padded IDs

  if (pendingFiles.length === 0) return;

  const pendingFile = pendingFiles[0];
  const pendingPath = path.join(QUEUE_DIR, pendingFile);

  // Derive the commission ID from the filename (e.g. "003-PENDING.md" → "003").
  const id = pendingFile.replace('-PENDING.md', '');

  // Read commission content.
  let commissionContent;
  try {
    commissionContent = fs.readFileSync(pendingPath, 'utf-8');
  } catch (err) {
    log('error', 'error', { id, msg: 'Failed to read PENDING file', error: err.message });
    return;
  }

  // Parse frontmatter for timeout_min override and title.
  const meta = parseFrontmatter(commissionContent);
  const timeoutMin = meta && meta.timeout_min && meta.timeout_min !== 'null'
    ? parseInt(meta.timeout_min, 10)
    : null;
  const effectiveTimeoutMs = timeoutMin != null && !isNaN(timeoutMin)
    ? timeoutMin * 60 * 1000
    : config.timeoutMs;
  const title = (meta && meta.title) || null;

  // Derive sibling paths.
  const inProgressPath = path.join(QUEUE_DIR, `${id}-IN_PROGRESS.md`);
  const donePath       = path.join(QUEUE_DIR, `${id}-DONE.md`);
  const errorPath      = path.join(QUEUE_DIR, `${id}-ERROR.md`);

  // ---------------------------------------------------------------------------
  // Validation on intake
  //
  // Before renaming to IN_PROGRESS, check that all required frontmatter fields
  // are present and non-empty. Required: id, title, from, to, priority, created.
  //
  // If validation fails:
  //   - Do NOT rename to IN_PROGRESS (file stays as PENDING for inspection)
  //   - Write an ERROR report immediately
  //   - Log with reason "invalid_commission"
  //   - Remove the PENDING file so the poll loop doesn't re-process it forever
  //   - Continue the poll loop (do not crash)
  // ---------------------------------------------------------------------------
  const REQUIRED_FIELDS = ['id', 'title', 'from', 'to', 'priority', 'created'];
  const missingFields = REQUIRED_FIELDS.filter(
    field => !meta || !meta[field] || meta[field].trim() === ''
  );

  if (missingFields.length > 0) {
    const errId   = (meta && meta.id) || id;
    const errPath = path.join(QUEUE_DIR, `${errId}-ERROR.md`);

    log('error', 'error', {
      id: errId,
      msg: 'Commission rejected — missing required frontmatter fields',
      reason: 'invalid_commission',
      missing_fields: missingFields,
      file: pendingFile,
    });

    // Stakeholder-friendly terminal output for rejected commissions.
    print(`  ${C.red}${SYM.cross}${C.reset} Commission ${errId} rejected${SYM.dash}Missing required fields: ${missingFields.join(', ')}`);

    writeErrorFile(errPath, errId, 'invalid_commission', null, '', '', { missingFields });
    log('info', 'state', { id: errId, from: 'PENDING', to: 'ERROR', reason: 'invalid_commission' });

    // Remove the invalid PENDING file so it doesn't loop indefinitely.
    try { fs.unlinkSync(pendingPath); } catch (_) {}

    return; // Continue poll loop on next tick.
  }

  // Atomic rename: PENDING → IN_PROGRESS.
  try {
    fs.renameSync(pendingPath, inProgressPath);
  } catch (err) {
    log('error', 'error', { id, msg: 'Failed to rename PENDING to IN_PROGRESS', error: err.message });
    return;
  }

  log('info', 'pickup', { id, title, msg: 'Commission picked up', file: pendingFile });
  log('info', 'state', { id, from: 'PENDING', to: 'IN_PROGRESS' });

  openCommissionBlock(id, title);

  processing = true;

  // Invoke Rook asynchronously — event loop stays live.
  invokeRook(commissionContent, donePath, inProgressPath, errorPath, id, effectiveTimeoutMs);
}

// ---------------------------------------------------------------------------
// Crash recovery (3.1)
// ---------------------------------------------------------------------------

/**
 * crashRecovery()
 *
 * Runs at startup before entering the poll loop. Scans the queue directory for
 * orphaned IN_PROGRESS files left behind by a prior crash and resolves each:
 *
 *   {id}-IN_PROGRESS alone           → rename back to PENDING (re-queue)
 *   {id}-IN_PROGRESS + DONE exists   → delete IN_PROGRESS (already complete)
 *   {id}-IN_PROGRESS + ERROR exists  → delete IN_PROGRESS (already failed)
 *
 * Returns an array of action records for display in the startup block.
 */
function crashRecovery() {
  const actions = [];
  let files;
  try {
    files = fs.readdirSync(QUEUE_DIR);
  } catch (err) {
    log('warn', 'startup_recovery', { msg: 'Cannot read queue dir for crash recovery', error: err.message });
    return actions;
  }

  const inProgressFiles = files.filter(f => f.endsWith('-IN_PROGRESS.md'));
  if (inProgressFiles.length === 0) return actions;

  for (const file of inProgressFiles) {
    const id             = file.replace('-IN_PROGRESS.md', '');
    const inProgressPath = path.join(QUEUE_DIR, file);
    const hasDone        = fs.existsSync(path.join(QUEUE_DIR, `${id}-DONE.md`));
    const hasError       = fs.existsSync(path.join(QUEUE_DIR, `${id}-ERROR.md`));

    if (hasDone || hasError) {
      // Commission already resolved — the IN_PROGRESS file is a stale artifact.
      const resolvedAs = hasDone ? 'DONE' : 'ERROR';
      try {
        fs.unlinkSync(inProgressPath);
        log('info', 'startup_recovery', {
          id,
          msg: `Orphaned IN_PROGRESS deleted (${resolvedAs} present)`,
          action: 'deleted',
          resolved_as: resolvedAs,
        });
        actions.push({ id, type: hasDone ? 'cleared' : 'cleared_error' });
      } catch (err) {
        log('warn', 'startup_recovery', { id, msg: 'Failed to delete orphaned IN_PROGRESS', error: err.message });
      }
    } else {
      // No resolution file — commission was interrupted mid-flight. Re-queue it.
      const pendingPath = path.join(QUEUE_DIR, `${id}-PENDING.md`);
      try {
        fs.renameSync(inProgressPath, pendingPath);  // atomic rename
        log('info', 'startup_recovery', {
          id,
          msg: 'Orphaned IN_PROGRESS renamed to PENDING (re-queued)',
          action: 're-queued',
        });
        actions.push({ id, type: 'requeued' });
      } catch (err) {
        log('warn', 'startup_recovery', { id, msg: 'Failed to rename orphaned IN_PROGRESS to PENDING', error: err.message });
      }
    }
  }

  return actions;
}

// ---------------------------------------------------------------------------
// Commission ID management (3.2)
// ---------------------------------------------------------------------------

/**
 * nextCommissionId(queueDir)
 *
 * Reads all filenames in queueDir, extracts their numeric prefix IDs, and
 * returns the next ID as a zero-padded three-digit string (e.g. "009").
 * Returns "001" if the directory is empty or unreadable.
 *
 * This function is purely computational — it does not write any files.
 * Exported so Mara can call it from .bridge/next-id.js.
 */
function nextCommissionId(queueDir) {
  let files;
  try {
    files = fs.readdirSync(queueDir);
  } catch (_) {
    return '001';
  }

  const ids = files
    .map(f => { const m = f.match(/^(\d+)-/); return m ? parseInt(m[1], 10) : null; })
    .filter(n => n !== null);

  if (ids.length === 0) return '001';
  return String(Math.max(...ids) + 1).padStart(3, '0');
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

function shutdown(signal) {
  log('info', 'shutdown', { msg: `Received ${signal} — shutting down` });
  if (processing) {
    log('warn', 'shutdown', {
      msg: 'A commission is in flight at shutdown. The IN_PROGRESS file will be recovered by crash recovery (Layer 3) on next startup.',
      current_commission: heartbeatState.current_commission,
    });
    print('');
    print(`  Watcher shutting down${SYM.dash}commission in progress will be recovered on next start.`);
  }
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// ---------------------------------------------------------------------------
// Startup — only runs when this file is executed directly (not when required)
// ---------------------------------------------------------------------------

if (require.main === module) {
  log('info', 'startup', {
    msg: 'Watcher started',
    config: {
      pollIntervalMs: config.pollIntervalMs,
      timeoutMs: config.timeoutMs,
      heartbeatIntervalMs: config.heartbeatIntervalMs,
      queueDir: QUEUE_DIR,
      logFile: LOG_FILE,
      heartbeatFile: HEARTBEAT_FILE,
      projectDir: PROJECT_DIR,
      claudeCommand: config.claudeCommand,
      claudeArgs: config.claudeArgs,
      maxRetries: config.maxRetries,
    },
  });

  const recoveryActions = crashRecovery();
  printStartupBlock(recoveryActions);

  // Initial heartbeat write so the file exists immediately on startup.
  writeHeartbeat();

  // Start heartbeat interval.
  setInterval(writeHeartbeat, config.heartbeatIntervalMs);

  // Start poll interval + immediate first poll.
  setInterval(poll, config.pollIntervalMs);
  poll();
}

// ---------------------------------------------------------------------------
// Exports — for use by helper scripts (e.g. .bridge/next-id.js)
// ---------------------------------------------------------------------------

module.exports = { nextCommissionId, getQueueSnapshot };
