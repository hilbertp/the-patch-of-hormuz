'use strict';

const fs = require('fs');
const path = require('path');
const { execFile, execSync } = require('child_process');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEFAULTS = {
  pollIntervalMs: 5000,
  inactivityTimeoutMs: 300000, // ms of no stdout/stderr activity before killing the child
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
  return {
    config: Object.assign({}, DEFAULTS, fileConfig),
    hasDeprecatedTimeoutMs: 'timeoutMs' in fileConfig,
  };
}

const { config, hasDeprecatedTimeoutMs } = loadConfig();

// ---------------------------------------------------------------------------
// Resolved paths
// ---------------------------------------------------------------------------

const QUEUE_DIR      = path.resolve(__dirname, config.queueDir);
const LOG_FILE       = path.resolve(__dirname, config.logFile);
const HEARTBEAT_FILE = path.resolve(__dirname, config.heartbeatFile);
const PROJECT_DIR    = path.resolve(__dirname, config.projectDir);
const REGISTER_FILE  = path.resolve(__dirname, 'register.jsonl');

// Ensure queue directory exists.
fs.mkdirSync(QUEUE_DIR, { recursive: true });

// Deprecation check: timeoutMs was the old wall-clock timeout. It is now ignored.
// Log once at startup if found in the config file.
if (hasDeprecatedTimeoutMs) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level: 'warn', event: 'deprecation', msg: 'Config key "timeoutMs" is deprecated and ignored. Use "inactivityTimeoutMs" instead.' });
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch (_) {}
}

// ---------------------------------------------------------------------------
// Activity tracking — updated by invokeOBrien when child process produces output.
// Exposed at module level so writeHeartbeat can include last_activity_ts.
// ---------------------------------------------------------------------------

let currentLastActivityTs = null; // null when idle, Date object when processing

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
  const ts              = timestampNow();
  const pollSec         = Math.round(config.pollIntervalMs / 1000);
  const inactivityMin   = Math.round(config.inactivityTimeoutMs / 60000);

  print('');
  print(hLine(B.dbl));
  print(`  Liberation of Bajor${SYM.sep}Watcher`);
  print(`  Started: ${ts}${SYM.sep}Polling every ${pollSec}s${SYM.sep}Inactivity kill: ${inactivityMin}min`);
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
      } else if (action.type === 'requeued_eval') {
        print(`    ${C.yellow}${SYM.back}${C.reset} Commission ${action.id}${SYM.dash}re-queued interrupted evaluation`);
      } else if (action.type === 'recovery_merged') {
        print(`    ${C.green}${SYM.check}${C.reset} Commission ${action.id}${SYM.dash}recovered merge: ${action.branch}${SYM.arrow}main (${action.sha.slice(0, 7)})`);
      } else if (action.type === 'recovery_merge_failed') {
        print(`    ${C.red}${SYM.cross}${C.reset} Commission ${action.id}${SYM.dash}recovery merge failed: ${action.reason}`);
      } else if (action.type === 'accepted_already_merged') {
        print(`    ${C.green}${SYM.check}${C.reset} Commission ${action.id}${SYM.dash}branch already on main (no merge needed)`);
      } else if (action.type === 'accepted_no_branch') {
        print(`    ${C.yellow}${SYM.cross}${C.reset} Commission ${action.id}${SYM.dash}ACCEPTED but no branch name — manual merge required`);
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
 * openCommissionBlock(id, title, goal)
 *
 * Prints the opening of a commission lifecycle block. Called at pickup.
 */
function openCommissionBlock(id, title, goal) {
  const titleStr = title ? `${SYM.sep}"${title}"` : '';
  print(`${B.tl}${B.sng.repeat(W - 1)}`);
  print(`${B.vert}  ${SYM.right} Commission ${id}${titleStr}`);
  if (goal) {
    print(`${B.vert}    Goal: ${goal}`);
  }
  print(`${B.vert}    Queued${SYM.arrow}Handed off to O'Brien`);
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
    print(`${B.vert}    Status: Done${SYM.arrow}Waiting for Kira's review`);
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
// Register — append-only event log (fortlaufende Liste)
//
// One JSON line per event. The commission body is embedded in the COMMISSIONED
// event so the original spec (with success criteria) is always recoverable.
// Kira's evaluation task reads this file instead of hunting for renamed/deleted
// queue files.
// ---------------------------------------------------------------------------

function registerEvent(id, event, extra) {
  const entry = Object.assign(
    { ts: new Date().toISOString(), id: String(id), event },
    extra || {}
  );
  try {
    fs.appendFileSync(REGISTER_FILE, JSON.stringify(entry) + '\n');
  } catch (err) {
    // Register write failure must not crash the watcher.
    log('warn', 'register_error', { id, msg: 'Failed to write register entry', error: err.message });
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
  current_commission_title: null,
  current_commission_goal: null,
  pickupTime: null,   // internal — not written to file
  processed_total: 0,
};

function writeHeartbeat() {
  const elapsedSeconds = heartbeatState.pickupTime
    ? Math.floor((Date.now() - heartbeatState.pickupTime) / 1000)
    : null;

  // Map getQueueSnapshot keys to the dashboard's expected schema:
  //   in_progress → active, completed → done, failed → error
  const raw = getQueueSnapshot(QUEUE_DIR);
  const queue = {
    waiting: raw.waiting,
    active:  raw.in_progress,
    done:    raw.completed,
    error:   raw.failed,
  };

  const snapshot = {
    ts: new Date().toISOString(),
    status: heartbeatState.status,
    current_commission: heartbeatState.current_commission,
    current_commission_title: heartbeatState.current_commission_title,
    current_commission_goal: heartbeatState.current_commission_goal,
    commission_elapsed_seconds: elapsedSeconds,
    last_activity_ts: currentLastActivityTs ? currentLastActivityTs.toISOString() : null,
    processed_total: heartbeatState.processed_total,
    queue,
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
let idlePrintCounter = 0;

// ---------------------------------------------------------------------------
// O'Brien invocation
// ---------------------------------------------------------------------------

/**
 * invokeOBrien(commissionContent, donePath, inProgressPath, errorPath, id, effectiveTimeoutMs)
 *
 * Pipes commission content + report path instruction to `claude -p`.
 * On success: checks donePath exists; if not, writes a fallback ERROR report.
 * On failure: writes an ERROR report.
 * Always cleans up the IN_PROGRESS file on completion (existence-checked to
 * avoid ENOENT when O'Brien's crash recovery already handled it).
 */
function invokeOBrien(commissionContent, donePath, inProgressPath, errorPath, id, effectiveInactivityMs, title, goal) {
  const prompt = commissionContent + '\n\nWrite your report to: ' + donePath;

  const pickupTime = Date.now();

  // Activity tracking: updated whenever the child writes to stdout or stderr.
  // killedByInactivity is set to true before we manually kill so the callback
  // can distinguish our inactivity kill from an external SIGTERM.
  let lastActivityTs = Date.now();
  let killedByInactivity = false;
  currentLastActivityTs = new Date();

  heartbeatState.status = 'processing';
  heartbeatState.current_commission = id;
  heartbeatState.current_commission_title = title || null;
  heartbeatState.current_commission_goal = goal || null;
  heartbeatState.pickupTime = pickupTime;
  writeHeartbeat();

  log('info', 'invoke', {
    id,
    msg: 'Invoking claude -p',
    command: config.claudeCommand,
    args: config.claudeArgs,
    cwd: PROJECT_DIR,
    inactivityTimeoutMs: effectiveInactivityMs,
  });

  // Progress tick: every 60s while O'Brien is running — stdout only, not bridge.log.
  const tickInterval = setInterval(() => {
    printProgressTick(Date.now() - pickupTime);
  }, 60000);

  const child = execFile(
    config.claudeCommand,
    config.claudeArgs,
    {
      cwd: PROJECT_DIR,
      encoding: 'utf-8',
      // No timeout here — we handle killing via inactivity check below.
      maxBuffer: 10 * 1024 * 1024, // 10 MB stdout buffer
    },
    (err, stdout, stderr) => {
      clearInterval(tickInterval);
      clearInterval(inactivityCheck);

      // Reset module-level activity state.
      currentLastActivityTs = null;

      const durationMs = Date.now() - pickupTime;

      // Extract token usage from JSON output (Task 2).
      // Falls back gracefully to nulls if output is not parseable JSON.
      const { tokensIn, tokensOut } = extractTokenUsage(stdout || '');
      const costUsd = computeCost(tokensIn, tokensOut);

      if (!err) {
        // Success path: check O'Brien wrote his DONE file.
        if (fs.existsSync(donePath)) {
          log('info', 'complete', { id, msg: "O'Brien finished — DONE file present", durationMs, tokensIn, tokensOut });
          log('info', 'state', { id, from: 'IN_PROGRESS', to: 'DONE' });
          registerEvent(id, 'DONE', { durationMs, tokensIn, tokensOut, costUsd });
          closeCommissionBlock(true, durationMs, tokensIn, tokensOut, costUsd, null);
          recordSessionResult(true, tokensIn, tokensOut, costUsd);
        } else {
          // O'Brien exited 0 but wrote no DONE file — write an ERROR report with reason "no_report".
          log('warn', 'complete', {
            id,
            msg: "O'Brien exited cleanly but wrote no DONE file — writing ERROR (no_report)",
            reason: 'no_report',
            durationMs,
          });
          writeErrorFile(errorPath, id, 'no_report', null, stdout, stderr);
          log('info', 'state', { id, from: 'IN_PROGRESS', to: 'ERROR', reason: 'no_report' });
          registerEvent(id, 'ERROR', { reason: 'no_report', durationMs });
          closeCommissionBlock(false, durationMs, tokensIn, tokensOut, costUsd, 'No report written');
          recordSessionResult(false, tokensIn, tokensOut, costUsd);
        }
      } else {
        // Failure path: distinguish inactivity kill vs other signals vs crash.
        let reason;
        let reasonDisplay;
        let extra = null;

        if (killedByInactivity) {
          const lastActivitySecondsAgo = Math.floor((Date.now() - lastActivityTs) / 1000);
          const inactivityLimitMinutes = Math.round(effectiveInactivityMs / 60000);
          reason = 'inactivity_timeout';
          reasonDisplay = `Inactivity timeout (${inactivityLimitMinutes}min)`;
          extra = { lastActivitySecondsAgo, inactivityLimitMinutes };
          log('error', 'inactivity_timeout', {
            id,
            msg: 'Commission killed due to inactivity',
            reason,
            lastActivitySecondsAgo,
            inactivityLimitMinutes,
            durationMs,
          });
        } else {
          reason = (err.killed && err.signal === 'SIGTERM') ? 'timeout' : 'crash';
          reasonDisplay = reason === 'timeout' ? 'Timed out' : 'Process failed';
          log('error', reason === 'timeout' ? 'timeout' : 'error', {
            id,
            msg: reason === 'timeout' ? 'Commission timed out' : 'claude -p failed',
            reason,
            exitCode: err.code,
            signal: err.signal || null,
            durationMs,
          });
        }

        writeErrorFile(errorPath, id, reason, err, stdout, stderr, extra);
        log('info', 'state', { id, from: 'IN_PROGRESS', to: 'ERROR', reason });
        registerEvent(id, 'ERROR', { reason, exitCode: err.code, durationMs });
        closeCommissionBlock(false, durationMs, tokensIn, tokensOut, costUsd, reasonDisplay);
        recordSessionResult(false, tokensIn, tokensOut, costUsd);
      }

      printSessionSummary();

      // Archive the original commission so Kira's evaluation task can find the
      // success criteria.  Rename IN_PROGRESS → COMMISSION (permanent archive).
      // The COMMISSION suffix is inert — the poll loop only looks for PENDING files.
      const commissionArchivePath = path.join(QUEUE_DIR, `${id}-COMMISSION.md`);
      if (fs.existsSync(inProgressPath)) {
        try {
          fs.renameSync(inProgressPath, commissionArchivePath);
          log('info', 'state', { id, msg: 'Archived commission', from: 'IN_PROGRESS', to: 'COMMISSION' });
        } catch (archiveErr) {
          // Fallback: if rename fails, try to delete so the queue doesn't jam.
          log('warn', 'error', { id, msg: 'Failed to archive IN_PROGRESS file, deleting instead', error: archiveErr.message });
          try { fs.unlinkSync(inProgressPath); } catch (_) {}
        }
      }

      // Reset processing state.
      processing = false;
      heartbeatState.status = 'idle';
      heartbeatState.current_commission = null;
      heartbeatState.current_commission_title = null;
      heartbeatState.current_commission_goal = null;
      heartbeatState.pickupTime = null;
      heartbeatState.processed_total += 1;
      writeHeartbeat();
    }
  );

  // Activity listeners: update lastActivityTs on any stdout/stderr output.
  // These run in addition to execFile's internal buffering — no conflict.
  child.stdout.on('data', () => {
    lastActivityTs = Date.now();
    currentLastActivityTs = new Date();
  });
  child.stderr.on('data', () => {
    lastActivityTs = Date.now();
    currentLastActivityTs = new Date();
  });

  // Inactivity check: every 30s, kill the child if no output for effectiveInactivityMs.
  const inactivityCheck = setInterval(() => {
    const silentMs = Date.now() - lastActivityTs;
    if (silentMs > effectiveInactivityMs) {
      const lastActivitySecondsAgo = Math.floor(silentMs / 1000);
      const inactivityLimitMinutes = Math.round(effectiveInactivityMs / 60000);
      log('warn', 'inactivity_timeout', {
        id,
        msg: `No output for ${lastActivitySecondsAgo}s — killing child process`,
        lastActivitySecondsAgo,
        inactivityLimitMinutes,
      });
      killedByInactivity = true;
      child.kill('SIGTERM');
    }
  }, 30000);

  // Feed the prompt to claude via stdin, then close stdin to signal EOF.
  child.stdin.write(prompt);
  child.stdin.end();
}

// ---------------------------------------------------------------------------
// Evaluator invocation
// ---------------------------------------------------------------------------

/**
 * callReviewAPI(id, verdict, reason)
 *
 * Fires a POST to /api/bridge/review. Non-blocking — failures are logged but
 * do not affect evaluator completion.
 */
function callReviewAPI(id, verdict, reason) {
  try {
    const http = require('http');
    const body = JSON.stringify({ id: String(id), verdict, reason: reason || '' });
    const req = http.request({
      hostname: '127.0.0.1',
      port: 4747,
      path: '/api/bridge/review',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      log('info', 'review_api', { id, verdict, status: res.statusCode });
    });
    req.on('error', (err) => {
      log('warn', 'review_api', { id, msg: 'POST /api/bridge/review failed', error: err.message });
    });
    req.write(body);
    req.end();
  } catch (err) {
    log('warn', 'review_api', { id, msg: 'Failed to call review API', error: err.message });
  }
}

/**
 * countReviewedCycles(rootId)
 *
 * Reads register.jsonl and counts REVIEWED events for a given root commission ID.
 * Returns 0 if the file is unreadable.
 */
function countReviewedCycles(rootId) {
  try {
    const lines = fs.readFileSync(REGISTER_FILE, 'utf-8').trim().split('\n').filter(Boolean);
    let count = 0;
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.event === 'REVIEWED' && (entry.id === String(rootId) || entry.root_commission_id === String(rootId))) {
          count++;
        }
      } catch (_) {}
    }
    return count;
  } catch (_) {
    return 0;
  }
}

/**
 * hasReviewEvent(id)
 *
 * Returns true if register.jsonl contains a REVIEWED, ACCEPTED, or STUCK event
 * for this commission ID — meaning it has already been evaluated.
 */
function hasReviewEvent(id) {
  try {
    const lines = fs.readFileSync(REGISTER_FILE, 'utf-8').trim().split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.id === String(id) && ['REVIEWED', 'ACCEPTED', 'STUCK'].includes(entry.event)) {
          return true;
        }
      } catch (_) {}
    }
  } catch (_) {}
  return false;
}

/**
 * extractJSON(text)
 *
 * Extracts and parses a JSON object from text that may contain preamble
 * and/or markdown code block wrapping. Tries in order:
 * 1. Markdown code block (```json or ```)
 * 2. First '{' to last '}'
 * 3. Raw text as JSON
 */
function extractJSON(text) {
  // Try markdown code block with optional json tag.
  const codeBlockMatch = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (codeBlockMatch) {
    try { return JSON.parse(codeBlockMatch[1]); } catch (_) {}
  }
  // Try first '{' to last '}'.
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch (_) {}
  }
  // Try raw.
  try { return JSON.parse(text); } catch (_) {}
  return null;
}

/**
 * invokeEvaluator(id)
 *
 * Reads the COMMISSION and EVALUATING files for the given commission ID,
 * constructs an evaluator prompt, calls claude -p, parses the JSON verdict,
 * and handles ACCEPTED / AMENDMENT_NEEDED / STUCK outcomes.
 */
function invokeEvaluator(id) {
  const commissionPath  = path.join(QUEUE_DIR, `${id}-COMMISSION.md`);
  const evaluatingPath  = path.join(QUEUE_DIR, `${id}-EVALUATING.md`);

  // Read COMMISSION file (original ACs).
  let commissionContent;
  try {
    commissionContent = fs.readFileSync(commissionPath, 'utf-8');
  } catch (err) {
    log('warn', 'evaluator', { id, msg: 'COMMISSION file not found — skipping evaluation', error: err.message });
    // Rename back to DONE so the poll loop can try again later.
    try { fs.renameSync(evaluatingPath, path.join(QUEUE_DIR, `${id}-DONE.md`)); } catch (_) {}
    processing = false;
    heartbeatState.status = 'idle';
    heartbeatState.current_commission = null;
    heartbeatState.current_commission_goal = null;
    heartbeatState.pickupTime = null;
    writeHeartbeat();
    return;
  }

  // Read EVALUATING file (O'Brien's DONE report).
  let evaluatingContent;
  try {
    evaluatingContent = fs.readFileSync(evaluatingPath, 'utf-8');
  } catch (err) {
    log('warn', 'evaluator', { id, msg: 'EVALUATING file not found — skipping evaluation', error: err.message });
    processing = false;
    heartbeatState.status = 'idle';
    heartbeatState.current_commission = null;
    heartbeatState.current_commission_goal = null;
    heartbeatState.pickupTime = null;
    writeHeartbeat();
    return;
  }

  // Extract branch name from O'Brien's DONE report frontmatter.
  const doneMeta = parseFrontmatter(evaluatingContent) || {};
  const branchName = doneMeta.branch || null;

  // Determine root commission ID and amendment cycle.
  const commissionMeta = parseFrontmatter(commissionContent) || {};
  const rootId = commissionMeta.root_commission_id || id;
  const cycle  = countReviewedCycles(rootId);

  log('info', 'evaluator', { id, rootId, cycle, branchName, msg: 'Starting evaluation' });
  print(`${B.tl}${B.sng.repeat(W - 1)}`);
  print(`${B.vert}  ${SYM.right} Evaluator${SYM.sep}Commission ${id} (cycle ${cycle + 1} of 5)`);
  print(`${B.vert}    Invoking Kira evaluator via claude -p`);
  print(`${B.vert}`);

  const prompt = [
    'You are Kira, Delivery Coordinator for Liberation of Bajor.',
    '',
    'Your job: evaluate whether O\'Brien\'s DONE report satisfies ALL acceptance criteria in the original commission. Be specific. If even one AC is not met, the verdict is AMENDMENT_NEEDED.',
    '',
    '## ORIGINAL COMMISSION (contains the acceptance criteria):',
    '',
    commissionContent,
    '',
    '## O\'BRIEN\'S DONE REPORT:',
    '',
    evaluatingContent,
    '',
    `## AMENDMENT CYCLE: ${cycle} of 5`,
    '',
    `## BRANCH: ${branchName || '(unknown — read from DONE report above)'}`,
    '',
    'Respond with ONLY valid JSON, no other text:',
    '{',
    '  "verdict": "ACCEPTED" or "AMENDMENT_NEEDED",',
    '  "reason": "One paragraph explaining your decision. Reference specific ACs.",',
    '  "failed_criteria": ["list of specific ACs that were not met, empty if ACCEPTED"],',
    '  "amendment_instructions": "If AMENDMENT_NEEDED: specific instructions for O\'Brien to fix each failed criterion. Reference file paths and expected changes. If ACCEPTED: empty string."',
    '}',
  ].join('\n');

  const pickupTime = Date.now();

  // Progress tick every 60s.
  const tickInterval = setInterval(() => {
    printProgressTick(Date.now() - pickupTime);
  }, 60000);

  const child = execFile(
    config.claudeCommand,
    config.claudeArgs,
    {
      cwd: PROJECT_DIR,
      encoding: 'utf-8',
      timeout: config.timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    },
    (err, stdout, stderr) => {
      clearInterval(tickInterval);
      const durationMs = Date.now() - pickupTime;

      let verdict = null;
      let reason = '';
      let failedCriteria = [];
      let amendmentInstructions = '';

      if (!err) {
        // Parse the evaluator's JSON response.
        // Claude may return: (a) JSON output wrapper with result field,
        // (b) preamble text + markdown code block, or (c) raw JSON.
        try {
          let rawText = stdout.trim();
          // Try to unwrap claude -p --output-format json envelope first.
          try {
            const claudeOutput = JSON.parse(rawText);
            rawText = claudeOutput.result || claudeOutput.content || rawText;
          } catch (_) {
            // Not a JSON envelope — rawText is the direct response.
          }
          const parsed = extractJSON(rawText);
          if (parsed) {
            verdict = parsed.verdict;
            reason = parsed.reason || '';
            failedCriteria = parsed.failed_criteria || [];
            amendmentInstructions = parsed.amendment_instructions || '';
          }
        } catch (parseErr) {
          log('warn', 'evaluator', { id, msg: 'Failed to parse evaluator JSON response', error: parseErr.message, stdout: stdout.slice(0, 500) });
        }
      } else {
        log('error', 'evaluator', { id, msg: 'claude -p evaluator failed', error: err.message, durationMs });
      }

      if (!verdict || !['ACCEPTED', 'AMENDMENT_NEEDED'].includes(verdict)) {
        // Fallback: rename EVALUATING back to DONE for re-evaluation.
        log('warn', 'evaluator', { id, msg: 'No valid verdict — requeueing for re-evaluation', verdict });
        try { fs.renameSync(evaluatingPath, path.join(QUEUE_DIR, `${id}-DONE.md`)); } catch (_) {}
        print(`${B.vert}    ${C.yellow}${SYM.back}${C.reset} Evaluation failed${SYM.sep}re-queued for retry`);
        print(`${B.bl}${B.sng.repeat(W - 1)}`);
        print('');
        processing = false;
        heartbeatState.status = 'idle';
        heartbeatState.current_commission = null;
        heartbeatState.current_commission_goal = null;
        heartbeatState.pickupTime = null;
        heartbeatState.processed_total += 1;
        writeHeartbeat();
        return;
      }

      // Determine if STUCK: cycle >= 5 and amendment needed.
      const isStuck = verdict === 'AMENDMENT_NEEDED' && cycle >= 5;
      const finalVerdict = isStuck ? 'STUCK' : verdict;

      if (finalVerdict === 'ACCEPTED') {
        handleAccepted(id, reason, cycle + 1, branchName, evaluatingPath, durationMs);
      } else if (finalVerdict === 'AMENDMENT_NEEDED') {
        handleAmendment(id, rootId, reason, failedCriteria, amendmentInstructions, cycle, branchName, evaluatingPath, commissionContent, durationMs);
      } else {
        handleStuck(id, reason, cycle, branchName, evaluatingPath, durationMs);
      }

      // Reset processing state.
      processing = false;
      heartbeatState.status = 'idle';
      heartbeatState.current_commission = null;
      heartbeatState.current_commission_goal = null;
      heartbeatState.pickupTime = null;
      heartbeatState.processed_total += 1;
      writeHeartbeat();
    }
  );

  child.stdin.write(prompt);
  child.stdin.end();
}

/**
 * mergeBranch(id, branchName, title)
 *
 * Performs git checkout main && git merge --no-ff {branch} && git push origin main.
 * Returns { success, sha, error } where sha is the merge commit hash on success.
 */
function mergeBranch(id, branchName, title) {
  const commitMsg = `merge: ${branchName} — ${title || `commission ${id}`} (commission ${id})`;
  try {
    execSync('git checkout main', { cwd: PROJECT_DIR, stdio: 'pipe' });
    execSync(`git merge --no-ff ${branchName} -m "${commitMsg.replace(/"/g, '\\"')}"`, { cwd: PROJECT_DIR, stdio: 'pipe' });
    const sha = execSync('git rev-parse HEAD', { cwd: PROJECT_DIR, encoding: 'utf-8' }).trim();
    try {
      execSync('git push origin main', { cwd: PROJECT_DIR, stdio: 'pipe' });
    } catch (pushErr) {
      // Push failure is non-fatal — the merge succeeded locally.
      log('warn', 'merge', { id, msg: 'git push origin main failed (merge succeeded locally)', error: pushErr.message });
    }
    return { success: true, sha, error: null };
  } catch (err) {
    // Abort any in-progress merge to leave git in a clean state.
    try { execSync('git merge --abort', { cwd: PROJECT_DIR, stdio: 'pipe' }); } catch (_) {}
    return { success: false, sha: null, error: err.stderr ? err.stderr.toString().trim() : err.message };
  }
}

/**
 * handleAccepted(id, reason, cycle, branchName, evaluatingPath, durationMs)
 *
 * ACCEPTED verdict: register event, rename EVALUATING → ACCEPTED, merge branch to main directly.
 */
function handleAccepted(id, reason, cycle, branchName, evaluatingPath, durationMs) {
  // Read title from commission file for the merge commit message.
  const commissionPath = path.join(QUEUE_DIR, `${id}-COMMISSION.md`);
  let title = null;
  try {
    const commMeta = parseFrontmatter(fs.readFileSync(commissionPath, 'utf-8'));
    if (commMeta) title = commMeta.title || null;
  } catch (_) {}

  registerEvent(id, 'ACCEPTED', { reason, cycle });
  log('info', 'evaluator', { id, verdict: 'ACCEPTED', cycle, durationMs });

  const acceptedPath = path.join(QUEUE_DIR, `${id}-ACCEPTED.md`);
  try {
    fs.renameSync(evaluatingPath, acceptedPath);
    log('info', 'state', { id, from: 'EVALUATING', to: 'ACCEPTED' });
  } catch (err) {
    log('warn', 'evaluator', { id, msg: 'Failed to rename EVALUATING to ACCEPTED', error: err.message });
  }

  callReviewAPI(id, 'ACCEPTED', reason);

  // Merge branch to main directly — no separate merge commission.
  if (!branchName) {
    log('warn', 'merge', { id, msg: 'No branch name in DONE report — skipping merge' });
    print(`${B.vert}    ${C.green}${SYM.check}${C.reset} ACCEPTED${SYM.sep}No branch in report — merge skipped`);
    print(`${B.bl}${B.sng.repeat(W - 1)}`);
    print('');
    return;
  }

  const result = mergeBranch(id, branchName, title);

  if (result.success) {
    const shortSha = result.sha.slice(0, 7);
    registerEvent(id, 'MERGED', { branch: branchName, sha: result.sha, commission_id: id });
    log('info', 'merge', { id, msg: `Merged ${branchName} to main`, branch: branchName, sha: result.sha });
    print(`${B.vert}    ${C.green}${SYM.check}${C.reset} ACCEPTED${SYM.sep}Merged ${branchName}${SYM.arrow}main (${shortSha})`);
  } else {
    registerEvent(id, 'MERGE_FAILED', { branch: branchName, reason: result.error, commission_id: id });
    log('error', 'merge', { id, msg: `Merge failed for ${branchName}`, branch: branchName, reason: result.error });
    print(`${B.vert}    ${C.green}${SYM.check}${C.reset} ACCEPTED${SYM.sep}${C.red}${SYM.cross}${C.reset} Merge failed: ${result.error}`);
  }

  print(`${B.bl}${B.sng.repeat(W - 1)}`);
  print('');
}

/**
 * handleAmendment(id, rootId, reason, failedCriteria, amendmentInstructions,
 *                 cycle, branchName, evaluatingPath, commissionContent, durationMs)
 *
 * AMENDMENT_NEEDED verdict: register event, rename EVALUATING → REVIEWED, write amendment PENDING.
 */
function handleAmendment(id, rootId, reason, failedCriteria, amendmentInstructions, cycle, branchName, evaluatingPath, commissionContent, durationMs) {
  registerEvent(id, 'REVIEWED', { verdict: 'AMENDMENT_NEEDED', reason, failed_criteria: failedCriteria, cycle: cycle + 1, root_commission_id: rootId });
  log('info', 'evaluator', { id, verdict: 'AMENDMENT_NEEDED', cycle: cycle + 1, rootId, durationMs });

  const reviewedPath = path.join(QUEUE_DIR, `${id}-REVIEWED.md`);
  try {
    fs.renameSync(evaluatingPath, reviewedPath);
    log('info', 'state', { id, from: 'EVALUATING', to: 'REVIEWED' });
  } catch (err) {
    log('warn', 'evaluator', { id, msg: 'Failed to rename EVALUATING to REVIEWED', error: err.message });
  }

  // Write amendment commission PENDING.
  const nextId = nextCommissionId(QUEUE_DIR);
  const failedList = (failedCriteria || []).map((c, i) => `${i + 1}. ${c}`).join('\n');
  const amendmentContent = [
    '---',
    `id: "${nextId}"`,
    `title: "Amendment ${cycle + 1} — fix failed criteria for commission ${rootId}"`,
    `goal: "All acceptance criteria from commission ${rootId} are met on branch ${branchName || '(original branch)'}."`,
    'from: kira',
    'to: obrien',
    'priority: normal',
    `created: "${new Date().toISOString()}"`,
    `references: "${id}"`,
    'timeout_min: null',
    'type: amendment',
    `root_commission_id: "${rootId}"`,
    `amendment_cycle: ${cycle + 1}`,
    `branch: "${branchName || ''}"`,
    '---',
    '',
    '## Objective',
    '',
    `This is an amendment to commission ${rootId} (cycle ${cycle + 1} of 5). Continue working on branch \`${branchName || '(see frontmatter branch field)'}\`. Do NOT create a new branch.`,
    '',
    '## Failed criteria',
    '',
    failedList || '(see amendment instructions below)',
    '',
    '## Amendment instructions',
    '',
    amendmentInstructions || '(see failed criteria above)',
    '',
    '## Original acceptance criteria (from commission ' + rootId + ')',
    '',
    commissionContent,
    '',
    '## Constraints',
    '',
    `Stay on branch \`${branchName || '(see frontmatter)'}\`. Do not create a new branch.`,
    '',
    '## Success criteria',
    '',
    '1. All failed criteria listed above are resolved.',
    '2. All original acceptance criteria from commission ' + rootId + ' are met.',
    '3. DONE report includes branch name in frontmatter.',
  ].join('\n');

  const amendmentPendingPath = path.join(QUEUE_DIR, `${nextId}-PENDING.md`);
  try {
    fs.writeFileSync(amendmentPendingPath, amendmentContent);
    log('info', 'evaluator', { id, msg: `Wrote amendment commission ${nextId}-PENDING.md`, nextId, cycle: cycle + 1, rootId });
  } catch (err) {
    log('warn', 'evaluator', { id, msg: 'Failed to write amendment commission PENDING', error: err.message });
  }

  callReviewAPI(id, 'AMENDMENT_NEEDED', reason);

  print(`${B.vert}    ${C.yellow}${SYM.cross}${C.reset} AMENDMENT_NEEDED (cycle ${cycle + 1})${SYM.sep}Amendment ${nextId} queued`);
  print(`${B.bl}${B.sng.repeat(W - 1)}`);
  print('');
}

/**
 * handleStuck(id, reason, cycle, branchName, evaluatingPath, durationMs)
 *
 * STUCK verdict: register event, rename EVALUATING → STUCK, no new PENDING.
 */
function handleStuck(id, reason, cycle, branchName, evaluatingPath, durationMs) {
  registerEvent(id, 'STUCK', { reason: 'amendment cap reached', cycle, branch: branchName });
  log('warn', 'evaluator', { id, verdict: 'STUCK', cycle, durationMs });

  const stuckPath = path.join(QUEUE_DIR, `${id}-STUCK.md`);
  try {
    fs.renameSync(evaluatingPath, stuckPath);
    log('info', 'state', { id, from: 'EVALUATING', to: 'STUCK' });
  } catch (err) {
    log('warn', 'evaluator', { id, msg: 'Failed to rename EVALUATING to STUCK', error: err.message });
  }

  callReviewAPI(id, 'STUCK', reason);

  print(`${B.vert}    ${C.red}${SYM.cross}${C.reset} STUCK${SYM.sep}Commission ${id} hit amendment cap (${cycle} cycles). Manual intervention required.`);
  print(`${B.bl}${B.sng.repeat(W - 1)}`);
  print('');
}

// ---------------------------------------------------------------------------
// ERROR file (written by watcher on invocation failure or invalid commission)
// ---------------------------------------------------------------------------

/**
 * writeErrorFile(errorPath, id, reason, err, stdout, stderr)
 *
 * Writes a structured ERROR report. The frontmatter always includes `reason`
 * so bridge.log and Kira's tooling can distinguish failure modes:
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
    'to: kira',
    'status: ERROR',
    `commission_id: "${id}"`,
    `completed: "${completed}"`,
    `reason: "${reason}"`,
  ];

  if (reason === 'crash' && exitCode !== null) {
    frontmatter.push(`exit_code: ${exitCode}`);
  }
  if (reason === 'inactivity_timeout') {
    if (extra && extra.lastActivitySecondsAgo != null) {
      frontmatter.push(`last_activity_seconds_ago: ${extra.lastActivitySecondsAgo}`);
    }
    if (extra && extra.inactivityLimitMinutes != null) {
      frontmatter.push(`inactivity_limit_minutes: ${extra.inactivityLimitMinutes}`);
    }
  }
  frontmatter.push('---');

  const truncate = (s, n) => (s && s.length > n ? '…' + s.slice(-n) : s || '(empty)');
  const stdoutBody = reason === 'no_report' ? truncate(stdout, 500) : (stdout || '(empty)');
  const stderrBody = reason === 'no_report' ? truncate(stderr, 500) : (stderr || '(empty)');

  const detail = reason === 'timeout'
    ? 'The process was killed after exceeding the configured timeout.'
    : reason === 'inactivity_timeout'
      ? `The process was killed after ${extra && extra.lastActivitySecondsAgo != null ? extra.lastActivitySecondsAgo : '?'}s of no stdout/stderr output (limit: ${extra && extra.inactivityLimitMinutes != null ? extra.inactivityLimitMinutes : '?'} min).`
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

  if (pendingFiles.length === 0) {
    // Priority 2: DONE files needing evaluation.
    const doneFiles = files.filter(f => f.endsWith('-DONE.md')).sort();
    for (const doneFile of doneFiles) {
      const doneId = doneFile.replace('-DONE.md', '');
      const donePath = path.join(QUEUE_DIR, doneFile);
      const commissionPath = path.join(QUEUE_DIR, `${doneId}-COMMISSION.md`);

      // Skip if COMMISSION file not present (O'Brien may still be running).
      if (!fs.existsSync(commissionPath)) continue;

      // Legacy: merge commissions (type: merge) are auto-accepted without claude -p.
      // Deprecated: handleAccepted() now merges directly — no new merge commissions
      // are generated. This block handles any legacy merge commissions still in the queue.
      let commissionMeta = {};
      try {
        commissionMeta = parseFrontmatter(fs.readFileSync(commissionPath, 'utf-8')) || {};
      } catch (_) {}

      if (commissionMeta.type === 'merge') {
        log('info', 'evaluator', { id: doneId, msg: 'Legacy merge commission auto-accepted (deprecated path)' });
        const acceptedPath = path.join(QUEUE_DIR, `${doneId}-ACCEPTED.md`);
        try { fs.renameSync(donePath, acceptedPath); } catch (_) {}
        registerEvent(doneId, 'ACCEPTED', { reason: 'auto-accepted merge', cycle: 0 });
        callReviewAPI(doneId, 'ACCEPTED', 'auto-accepted merge');
        print(`  ${C.green}${SYM.check}${C.reset} Commission ${doneId}${SYM.dash}Merge auto-accepted`);
        continue;
      }

      // Skip if already reviewed.
      if (hasReviewEvent(doneId)) continue;

      // Rename DONE → EVALUATING to claim it.
      const evaluatingPath = path.join(QUEUE_DIR, `${doneId}-EVALUATING.md`);
      try {
        fs.renameSync(donePath, evaluatingPath);
        log('info', 'state', { id: doneId, from: 'DONE', to: 'EVALUATING' });
      } catch (err) {
        log('warn', 'evaluator', { id: doneId, msg: 'Failed to rename DONE to EVALUATING', error: err.message });
        continue;
      }

      processing = true;
      heartbeatState.status = 'evaluating';
      heartbeatState.current_commission = doneId;
      heartbeatState.current_commission_goal = commissionMeta.goal || null;
      heartbeatState.pickupTime = Date.now();
      writeHeartbeat();

      invokeEvaluator(doneId);
      return;
    }

    idlePrintCounter += 1;
    if (idlePrintCounter >= 12) {
      idlePrintCounter = 0;
      const snap = getQueueSnapshot(QUEUE_DIR);
      const ts = timestampNow();
      print(`  ${C.dim}·${C.reset}  Queue: ${snap.waiting} waiting${SYM.sep}${snap.in_progress} in progress${SYM.sep}${snap.completed} done${SYM.sep}${snap.failed} failed  [${ts}]`);
    }
    return;
  }

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
  // timeout_min now means "minutes of inactivity before kill" (overrides inactivityTimeoutMs).
  const effectiveInactivityMs = timeoutMin != null && !isNaN(timeoutMin)
    ? timeoutMin * 60 * 1000
    : config.inactivityTimeoutMs;
  const title = (meta && meta.title) || null;
  const goal  = (meta && meta.goal && meta.goal.trim()) || null;

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
    registerEvent(errId, 'ERROR', { reason: 'invalid_commission', missingFields });

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

  // Register: embed full commission body so success criteria are always recoverable.
  registerEvent(id, 'COMMISSIONED', { title, goal, body: commissionContent });

  openCommissionBlock(id, title, goal);

  processing = true;

  // Invoke O'Brien asynchronously — event loop stays live.
  invokeOBrien(commissionContent, donePath, inProgressPath, errorPath, id, effectiveInactivityMs, title, goal);
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

  // Recover orphaned EVALUATING files → rename back to DONE for re-evaluation.
  const evaluatingFiles = files.filter(f => f.endsWith('-EVALUATING.md'));
  for (const file of evaluatingFiles) {
    const id              = file.replace('-EVALUATING.md', '');
    const evaluatingPath  = path.join(QUEUE_DIR, file);
    const donePath        = path.join(QUEUE_DIR, `${id}-DONE.md`);
    try {
      fs.renameSync(evaluatingPath, donePath);
      log('info', 'startup_recovery', { id, msg: 'Orphaned EVALUATING renamed to DONE (re-queued for evaluation)', action: 're-queued-eval' });
      actions.push({ id, type: 'requeued_eval' });
    } catch (err) {
      log('warn', 'startup_recovery', { id, msg: 'Failed to rename orphaned EVALUATING to DONE', error: err.message });
    }
  }

  // Recover orphaned ACCEPTED files — merge was not completed before crash.
  // Check if the branch is already on main; if not, re-attempt merge.
  const acceptedFiles = files.filter(f => f.endsWith('-ACCEPTED.md'));
  for (const file of acceptedFiles) {
    const id = file.replace('-ACCEPTED.md', '');
    const acceptedPath = path.join(QUEUE_DIR, file);

    // Read branch name from the ACCEPTED file (which is the renamed DONE report).
    let branchName = null;
    let title = null;
    try {
      const content = fs.readFileSync(acceptedPath, 'utf-8');
      const meta = parseFrontmatter(content);
      if (meta) branchName = meta.branch || null;
    } catch (_) {}

    // Read title from COMMISSION file.
    try {
      const commContent = fs.readFileSync(path.join(QUEUE_DIR, `${id}-COMMISSION.md`), 'utf-8');
      const commMeta = parseFrontmatter(commContent);
      if (commMeta) title = commMeta.title || null;
    } catch (_) {}

    if (!branchName) {
      log('warn', 'startup_recovery', { id, msg: 'Orphaned ACCEPTED file has no branch — cannot recover merge' });
      actions.push({ id, type: 'accepted_no_branch' });
      continue;
    }

    // Check if branch is already merged to main.
    let alreadyMerged = false;
    try {
      const merged = execSync('git branch --merged main', { cwd: PROJECT_DIR, encoding: 'utf-8' });
      alreadyMerged = merged.split('\n').some(line => line.trim() === branchName);
    } catch (_) {}

    if (alreadyMerged) {
      log('info', 'startup_recovery', { id, msg: `Branch ${branchName} already on main — no merge needed`, branch: branchName });
      actions.push({ id, type: 'accepted_already_merged', branch: branchName });
      continue;
    }

    // Re-attempt merge.
    const result = mergeBranch(id, branchName, title);
    if (result.success) {
      registerEvent(id, 'MERGED', { branch: branchName, sha: result.sha, commission_id: id, recovery: true });
      log('info', 'startup_recovery', { id, msg: `Recovery merge succeeded for ${branchName}`, branch: branchName, sha: result.sha });
      actions.push({ id, type: 'recovery_merged', branch: branchName, sha: result.sha });
    } else {
      registerEvent(id, 'MERGE_FAILED', { branch: branchName, reason: result.error, commission_id: id, recovery: true });
      log('warn', 'startup_recovery', { id, msg: `Recovery merge failed for ${branchName}`, branch: branchName, reason: result.error });
      actions.push({ id, type: 'recovery_merge_failed', branch: branchName, reason: result.error });
    }
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
 * Exported so Kira can call it from bridge/next-id.js.
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
      inactivityTimeoutMs: config.inactivityTimeoutMs,
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
// Exports — for use by helper scripts (e.g. bridge/next-id.js)
// ---------------------------------------------------------------------------

module.exports = { nextCommissionId, getQueueSnapshot };
