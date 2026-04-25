'use strict';

const fs = require('fs');
const path = require('path');
const { execFile, execSync } = require('child_process');
const { appendTimesheet, updateTimesheet, rebuildMerged } = require('./slicelog');
const { appendKiraEvent } = require('./kira-events');
const { buildNogPrompt } = require('./nog-prompt');
const { translateEvent, translateVerdict, resetDedupeState } = require('./lifecycle-translate');
const gitFinalizer = require('./git-finalizer');

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
    // This is intentional: the orchestrator must work with zero configuration.
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
const STAGED_DIR     = path.resolve(__dirname, 'staged');
const LOG_FILE       = path.resolve(__dirname, config.logFile);
const HEARTBEAT_FILE = path.resolve(__dirname, config.heartbeatFile);
const PROJECT_DIR    = path.resolve(__dirname, config.projectDir);
let REGISTER_FILE  = path.resolve(__dirname, 'register.jsonl');
const RESTAGED_BOOTSTRAP_MARKER = path.resolve(__dirname, '.restaged-bootstrap-done');
const NOG_ACTIVE_FILE = path.resolve(__dirname, 'nog-active.json');
const TRASH_DIR      = path.resolve(QUEUE_DIR, '..', 'trash');
const WORKTREE_BASE  = '/tmp/ds9-worktrees';
const LOGS_DIR       = path.resolve(__dirname, 'logs');
const ESCALATIONS_DIR = path.resolve(__dirname, 'kira-escalations');
const CONTROL_DIR    = path.resolve(__dirname, 'control');

// Ensure queue + trash + logs + escalations + control directories exist.
fs.mkdirSync(QUEUE_DIR, { recursive: true });
fs.mkdirSync(TRASH_DIR, { recursive: true });
fs.mkdirSync(LOGS_DIR, { recursive: true });
fs.mkdirSync(ESCALATIONS_DIR, { recursive: true });
fs.mkdirSync(CONTROL_DIR, { recursive: true });

// Deprecation check: timeoutMs was the old wall-clock timeout. It is now ignored.
// Log once at startup if found in the config file.
if (hasDeprecatedTimeoutMs) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level: 'warn', event: 'deprecation', msg: 'Config key "timeoutMs" is deprecated and ignored. Use "inactivityTimeoutMs" instead.' });
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch (_) {}
}

// ---------------------------------------------------------------------------
// Activity tracking — updated by invokeRom when child process produces output.
// Exposed at module level so writeHeartbeat can include last_activity_ts.
// ---------------------------------------------------------------------------

let currentLastActivityTs = null; // null when idle, Date object when processing

// ---------------------------------------------------------------------------
// Rate limit state — set when Claude API returns a rate-limit response.
// Poll loop skips dispatch while Date.now() < rateLimitUntil.
// ---------------------------------------------------------------------------

let rateLimitUntil = null; // null = not rate-limited; epoch ms = blocked until

/**
 * parseRateLimitResetMs(stdout)
 *
 * Tries to extract the reset time from a Claude API rate-limit message
 * like: "resets 4am (Asia/Nicosia)"
 * Returns ms from now until the reset, or null if parsing fails.
 */
function parseRateLimitResetMs(stdout) {
  try {
    const match = stdout.match(/resets\s+(\d+)(?::(\d+))?\s*(am|pm)\s*\(([^)]+)\)/i);
    if (!match) return null;

    let hours   = parseInt(match[1], 10);
    const mins  = parseInt(match[2] || '0', 10);
    const amPm  = match[3].toLowerCase();
    const tz    = match[4];

    if (amPm === 'am') {
      if (hours === 12) hours = 0;
    } else {
      if (hours !== 12) hours += 12;
    }

    // Build a Date for today at the reset time in the stated timezone.
    // We do this by formatting the current date parts in the target TZ,
    // constructing an ISO string, then adjusting if the reset is already past.
    const now       = new Date();
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
    });
    const localDate = formatter.format(now); // "YYYY-MM-DD"

    // Try today's reset.
    const candidate = new Date(`${localDate}T${String(hours).padStart(2,'0')}:${String(mins).padStart(2,'0')}:00`);
    // candidate is in local (watcher) time — convert by using timezone offset.
    // Simpler: express the target as UTC directly via Intl.
    const utcMs = Date.parse(
      `${localDate}T${String(hours).padStart(2,'0')}:${String(mins).padStart(2,'0')}:00`
      // This gives local midnight + hours — imprecise across DST but good enough.
    );
    // If that time is already past, add 24h.
    const resetMs = utcMs > Date.now() ? utcMs : utcMs + 86400000;
    const waitMs  = resetMs - Date.now();
    if (waitMs > 0 && waitMs < 86400000) return waitMs; // sanity: < 24h
  } catch (_) {}
  return null;
}

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

function printUnmergedAlert(id, title, branchName) {
  const msg = [
    '',
    '⚠️  UNMERGED BRANCH — Philipp action required',
    `    Slice ${id}: ${title || '(unknown)'}`,
    `    Branch: ${branchName}`,
    '    Status: ACCEPTED but not merged to main',
    `    Fix: git merge --no-ff ${branchName} && git push origin main`,
    '',
  ].join('\n');
  print(msg);
}

function printMergeFailedAlert(id, title, branchName, errorMsg) {
  const msg = [
    '',
    '⚠️  MERGE FAILED — Philipp action required',
    `    Slice ${id}: ${title || '(unknown)'}`,
    `    Branch: ${branchName}`,
    `    Error: ${errorMsg}`,
    `    Fix: git merge --no-ff ${branchName} && git push origin main`,
    '',
  ].join('\n');
  print(msg);
}

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

/**
 * validateDoneMetrics(meta)
 *
 * Validates that the DONE report frontmatter contains all five required
 * metrics fields with correct types. Returns { ok, invalid }.
 */
function validateDoneMetrics(meta) {
  if (!meta) return { ok: false, invalid: ['tokens_in', 'tokens_out', 'elapsed_ms', 'estimated_human_hours', 'compaction_occurred'] };

  const invalid = [];

  // tokens_in: non-negative integer
  const ti = parseInt(meta.tokens_in, 10);
  if (meta.tokens_in == null || isNaN(ti) || ti < 0) invalid.push('tokens_in');

  // tokens_out: non-negative integer
  const to = parseInt(meta.tokens_out, 10);
  if (meta.tokens_out == null || isNaN(to) || to < 0) invalid.push('tokens_out');

  // elapsed_ms: positive integer
  const el = parseInt(meta.elapsed_ms, 10);
  if (meta.elapsed_ms == null || isNaN(el) || el <= 0) invalid.push('elapsed_ms');

  // estimated_human_hours: positive number
  const eh = parseFloat(meta.estimated_human_hours);
  if (meta.estimated_human_hours == null || isNaN(eh) || eh <= 0) invalid.push('estimated_human_hours');

  // compaction_occurred: boolean
  if (meta.compaction_occurred !== 'true' && meta.compaction_occurred !== 'false') invalid.push('compaction_occurred');

  return { ok: invalid.length === 0, invalid };
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
  const tokenStr   = session.hasTokens
    ? `${(session.tokensIn + session.tokensOut).toLocaleString()} tokens`
    : 'tokens: unknown';
  const costStr    = session.hasTokens ? `${SYM.sep}${formatCost(session.costUsd)}` : '';
  print(`  Session: ${session.completed} completed${SYM.sep}${session.failed} failed${SYM.sep}${tokenStr}${costStr}`);
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
  const waiting     = files.filter(f => f.endsWith('-QUEUED.md') || f.endsWith('-PENDING.md')).length;
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
        print(`    ${C.green}${SYM.check}${C.reset} Slice ${action.id}${SYM.dash}cleared stale work-in-progress (already completed)`);
      } else if (action.type === 'cleared_error') {
        print(`    ${C.yellow}${SYM.check}${C.reset} Slice ${action.id}${SYM.dash}cleared stale work-in-progress (already failed)`);
      } else if (action.type === 'requeued') {
        print(`    ${C.yellow}${SYM.back}${C.reset} Slice ${action.id}${SYM.dash}re-queued interrupted slice`);
      } else if (action.type === 'requeued_eval') {
        print(`    ${C.yellow}${SYM.back}${C.reset} Slice ${action.id}${SYM.dash}re-queued interrupted evaluation`);
      } else if (action.type === 'recovery_merged') {
        print(`    ${C.green}${SYM.check}${C.reset} Slice ${action.id}${SYM.dash}recovered merge: ${action.branch}${SYM.arrow}main (${action.sha.slice(0, 7)})`);
      } else if (action.type === 'recovery_merge_failed') {
        print(`    ${C.red}${SYM.cross}${C.reset} Slice ${action.id}${SYM.dash}recovery merge failed: ${action.reason}`);
      } else if (action.type === 'accepted_already_merged') {
        print(`    ${C.green}${SYM.check}${C.reset} Slice ${action.id}${SYM.dash}branch already on main (no merge needed)`);
      } else if (action.type === 'accepted_no_branch') {
        print(`    ${C.yellow}${SYM.cross}${C.reset} Slice ${action.id}${SYM.dash}ACCEPTED but no branch name — manual merge required`);
      }
    }
  }

  const snapshot = getQueueSnapshot(QUEUE_DIR);
  print('');
  print('  Queue snapshot:');
  const isEmpty = snapshot.waiting === 0 && snapshot.in_progress === 0
               && snapshot.completed === 0 && snapshot.failed === 0;
  if (isEmpty) {
    print(`    Queue is empty${SYM.dash}watching for new slices.`);
  } else {
    print(`    ${SYM.clip}${snapshot.waiting} waiting${SYM.sep}${snapshot.in_progress} in progress${SYM.sep}${snapshot.completed} completed${SYM.sep}${snapshot.failed} failed`);
  }

  // Log staged slices count
  let stagedCount = 0;
  try {
    const stagedFiles = fs.readdirSync(STAGED_DIR).filter(f => f.endsWith('-STAGED.md') || f.endsWith('-NEEDS_APENDMENT.md') || f.endsWith('-NEEDS_AMENDMENT.md'));
    stagedCount = stagedFiles.length;
  } catch (_) {}
  if (stagedCount > 0) {
    print(`    ${C.yellow}ℹ${C.reset}  ${stagedCount} slice(s) awaiting your review in bridge/staged/`);
  }

  print(hLine(B.sng));
  print('');
}

// ---------------------------------------------------------------------------
// Slice lifecycle blocks (Task 3)
// ---------------------------------------------------------------------------

/**
 * openSliceBlock(id, title, goal)
 *
 * Prints the opening of a slice lifecycle block. Called at pickup.
 */
function openSliceBlock(id, title, goal) {
  const titleStr = title ? `${SYM.sep}"${title}"` : '';
  print(`${B.tl}${B.sng.repeat(W - 1)}`);
  print(`${B.vert}  ${SYM.right} Slice ${id}${titleStr}`);
  if (goal) {
    print(`${B.vert}    Goal: ${goal}`);
  }
  print(`${B.vert}    Queued${SYM.arrow}Handed off to Rom`);
  print(`${B.vert}`);
}

/**
 * printProgressTick(elapsedMs)
 *
 * Appends a progress line inside the open slice block. Called every 60s.
 */
function printProgressTick(elapsedMs) {
  const elapsed = formatDuration(elapsedMs);
  print(`${B.vert}    ${C.yellow}${SYM.clock}${C.reset} Working${SYM.dots} ${elapsed}`);
}

/**
 * closeSliceBlock(success, durationMs, tokensIn, tokensOut, costUsd, reason)
 *
 * Prints the completion or failure lines and closes the slice block.
 */
function closeSliceBlock(success, durationMs, tokensIn, tokensOut, costUsd, reason) {
  const duration  = formatDuration(durationMs);
  const tokenStr  = formatTokens(tokensIn, tokensOut);
  const costStr   = formatCost(costUsd);

  if (success) {
    const parts = [duration, tokenStr];
    if (costStr) parts.push(costStr);
    print(`${B.vert}    ${C.green}${SYM.check}${C.reset} Complete${SYM.sep}${parts.join(SYM.sep)}`);
    print(`${B.vert}    Status: Done${SYM.arrow}Waiting for Nog's review`);
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
    // Log file write failure must not crash the orchestrator.
    process.stdout.write('[log-write-error] ' + err.message + '\n');
  }
}

// ---------------------------------------------------------------------------
// Register — append-only event log (fortlaufende Liste)
//
// One JSON line per event. The slice body is embedded in the COMMISSIONED
// event so the original spec (with success criteria) is always recoverable.
// Nog's evaluation task reads this file instead of hunting for renamed/deleted
// queue files.
// ---------------------------------------------------------------------------

/**
 * truncStderr(s) — Truncate stderr to last 2000 chars for register readability.
 */
function truncStderr(s) {
  if (!s || typeof s !== 'string') return '';
  return s.length > 2000 ? s.slice(-2000) : s;
}

/**
 * INVARIANT: registerEvent is the SOLE writer of pipeline events to register.jsonl.
 *
 * All state transitions must flow through this function, synchronously, in canonical
 * order: dev → review → accept → merge. No HTTP handler, SSE push, CLI helper, or
 * background task may append to register.jsonl directly. If you are about to add a
 * second writer, stop — use registerEvent or emit a control-file action for the
 * orchestrator to dispatch synchronously. Slices 168 + 169 removed the last side channel
 * (callReviewAPI); keep it that way.
 */
// Write-time dedupe for MERGED events on (slice_id, sha).
const _writtenMerged = new Set();

function registerEvent(id, event, extra) {
  // Dedupe MERGED at write time on (slice_id, sha)
  if (event === 'MERGED' && extra && extra.sha) {
    const key = `${extra.slice_id || id}:${extra.sha}`;
    if (_writtenMerged.has(key)) {
      log('info', 'register_dedupe', { id, msg: `Duplicate MERGED suppressed for ${key}` });
      return;
    }
    _writtenMerged.add(key);
  }

  const entry = Object.assign(
    { ts: new Date().toISOString(), slice_id: String(id), event },
    extra || {}
  );
  try {
    fs.appendFileSync(REGISTER_FILE, JSON.stringify(entry) + '\n');
  } catch (err) {
    // Register write failure must not crash the orchestrator.
    log('warn', 'register_error', { id, msg: 'Failed to write register entry', error: err.message });
  }
}

/**
 * registerCommissioned(id, extra)
 *
 * Writes a COMMISSIONED register event with one retry on failure.
 * A missing COMMISSIONED event means the history panel shows no title —
 * this is data loss, not a minor hiccup, so we retry and alert loudly.
 */
function registerCommissioned(id, extra) {
  const entry = Object.assign(
    { ts: new Date().toISOString(), slice_id: String(id), event: 'COMMISSIONED' },
    extra || {}
  );
  const line = JSON.stringify(entry) + '\n';
  try {
    fs.appendFileSync(REGISTER_FILE, line);
  } catch (firstErr) {
    log('warn', 'register_error', { id, msg: 'COMMISSIONED write failed, retrying…', error: firstErr.message });
    try {
      fs.appendFileSync(REGISTER_FILE, line);
    } catch (retryErr) {
      log('error', 'register_error', { id, msg: 'COMMISSIONED write failed after retry', error: retryErr.message });
      process.stdout.write(`\n⚠️  CRITICAL: COMMISSIONED register write FAILED for slice ${id} after retry. History title will be missing. Error: ${retryErr.message}\n`);
    }
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

// Sets or replaces key-value pairs in YAML frontmatter. Returns updated text.
function updateFrontmatter(text, updates) {
  const lines = text.split('\n');
  let start = -1, end = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      if (start === -1) { start = i; } else { end = i; break; }
    }
  }
  if (start === -1 || end === -1) return text;
  const fmLines = lines.slice(start + 1, end);
  for (const [key, val] of Object.entries(updates)) {
    const idx = fmLines.findIndex(l => {
      const c = l.indexOf(':');
      return c !== -1 && l.slice(0, c).trim() === key;
    });
    const newLine = `${key}: "${val}"`;
    if (idx !== -1) fmLines[idx] = newLine;
    else fmLines.push(newLine);
  }
  return [...lines.slice(0, start + 1), ...fmLines, ...lines.slice(end)].join('\n');
}

/**
 * appendRoundEntry(sliceFilePath, roundEntry)
 *
 * Appends a round entry to the slice file's frontmatter `rounds:` YAML array
 * and recomputes slice-level `total_*` fields. The entry is a plain object:
 * { round, commissioned_at, done_at, durationMs, tokensIn, tokensOut, costUsd, nog_verdict, nog_reason }
 *
 * Frontmatter `rounds:` is stored as a YAML block sequence inside the --- fences.
 * After appending, total_durationMs/total_tokensIn/total_tokensOut/total_costUsd are recomputed.
 */
function appendRoundEntry(sliceFilePath, roundEntry) {
  let content;
  try {
    content = fs.readFileSync(sliceFilePath, 'utf-8');
  } catch (err) {
    log('warn', 'rounds', { msg: 'Cannot read slice file for rounds append', path: sliceFilePath, error: err.message });
    return;
  }

  const lines = content.split('\n');
  let fmStart = -1, fmEnd = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      if (fmStart === -1) { fmStart = i; } else { fmEnd = i; break; }
    }
  }
  if (fmStart === -1 || fmEnd === -1) {
    log('warn', 'rounds', { msg: 'No frontmatter found in slice file', path: sliceFilePath });
    return;
  }

  // Build the YAML lines for this round entry.
  const yamlEntry = [
    `  - round: ${roundEntry.round}`,
    `    commissioned_at: "${roundEntry.commissioned_at || ''}"`,
    `    done_at: "${roundEntry.done_at || ''}"`,
    `    durationMs: ${roundEntry.durationMs || 0}`,
    `    tokensIn: ${roundEntry.tokensIn || 0}`,
    `    tokensOut: ${roundEntry.tokensOut || 0}`,
    `    costUsd: ${roundEntry.costUsd != null ? roundEntry.costUsd : 0}`,
    `    nog_verdict: "${roundEntry.nog_verdict || ''}"`,
    `    nog_reason: "${(roundEntry.nog_reason || '').replace(/"/g, '\\"')}"`,
  ];

  // Find existing rounds: block or insert after last frontmatter field.
  const fmLines = lines.slice(fmStart + 1, fmEnd);
  const roundsIdx = fmLines.findIndex(l => /^rounds:\s*$/.test(l.trim()) || /^rounds:$/.test(l.trim()));

  if (roundsIdx === -1) {
    // No rounds: field yet — add it.
    fmLines.push('rounds:');
    fmLines.push(...yamlEntry);
  } else {
    // Find the end of the existing rounds block (indented lines after rounds:).
    let insertAt = roundsIdx + 1;
    while (insertAt < fmLines.length && /^\s{2,}-?\s/.test(fmLines[insertAt])) {
      insertAt++;
    }
    fmLines.splice(insertAt, 0, ...yamlEntry);
  }

  // Parse all rounds to recompute totals.
  let totalDuration = 0, totalIn = 0, totalOut = 0, totalCost = 0;
  for (let i = 0; i < fmLines.length; i++) {
    const m = fmLines[i].match(/^\s+durationMs:\s*(\d+)/);
    if (m) totalDuration += parseInt(m[1], 10);
    const m2 = fmLines[i].match(/^\s+tokensIn:\s*(\d+)/);
    if (m2) totalIn += parseInt(m2[1], 10);
    const m3 = fmLines[i].match(/^\s+tokensOut:\s*(\d+)/);
    if (m3) totalOut += parseInt(m3[1], 10);
    const m4 = fmLines[i].match(/^\s+costUsd:\s*([\d.]+)/);
    if (m4) totalCost += parseFloat(m4[1]);
  }

  // Update or insert total_* fields.
  const totals = {
    total_durationMs: String(totalDuration),
    total_tokensIn: String(totalIn),
    total_tokensOut: String(totalOut),
    total_costUsd: String(parseFloat(totalCost.toFixed(6))),
  };

  for (const [key, val] of Object.entries(totals)) {
    const idx = fmLines.findIndex(l => {
      const c = l.indexOf(':');
      return c !== -1 && l.slice(0, c).trim() === key;
    });
    const newLine = `${key}: ${val}`;
    if (idx !== -1) fmLines[idx] = newLine;
    else fmLines.push(newLine);
  }

  // Also update round field at slice level.
  const roundFieldIdx = fmLines.findIndex(l => {
    const c = l.indexOf(':');
    return c !== -1 && l.slice(0, c).trim() === 'round' && !/^\s/.test(l);
  });
  const roundLine = `round: ${roundEntry.round}`;
  if (roundFieldIdx !== -1) fmLines[roundFieldIdx] = roundLine;
  else fmLines.push(roundLine);

  const result = [...lines.slice(0, fmStart + 1), ...fmLines, ...lines.slice(fmEnd)].join('\n');
  try {
    fs.writeFileSync(sliceFilePath, result);
  } catch (err) {
    log('warn', 'rounds', { msg: 'Failed to write updated slice file', path: sliceFilePath, error: err.message });
  }
}

/**
 * extractRomTelemetry(doneReportContent)
 *
 * Pulls durationMs, tokensIn, tokensOut, costUsd from a Rom DONE report's frontmatter.
 */
function extractRomTelemetry(doneReportContent) {
  const meta = parseFrontmatter(doneReportContent) || {};
  const tokensIn = parseInt(meta.tokens_in, 10) || 0;
  const tokensOut = parseInt(meta.tokens_out, 10) || 0;
  return {
    durationMs: parseInt(meta.elapsed_ms, 10) || 0,
    tokensIn,
    tokensOut,
    costUsd: computeCost(tokensIn, tokensOut) || 0,
    commissioned_at: meta.created || meta.commissioned_at || '',
    done_at: meta.completed || '',
  };
}

// ---------------------------------------------------------------------------
// Git safety layer — FUSE-safe branch management
// ---------------------------------------------------------------------------
//
// The FUSE mount blocks fs.unlink (EPERM). Git checkout uses unlink internally
// to replace tracked files when switching branches, so `git checkout main`
// silently fails whenever files differ between the current branch and main.
//
// This caused repeated regressions: Chief O'Brien's direct edits or merged
// features would vanish from disk because checkout left stale branch files.
//
// Strategy (immutable rules):
//
//   1. AUTO-COMMIT before processing — any dirty tracked files are committed
//      to the current branch before we attempt to switch. No uncommitted
//      changes are ever discarded.
//
//   2. FUSE-SAFE CHECKOUT — instead of `git checkout main`:
//      a. Detect differing files via `git diff --name-only HEAD main`
//      b. Overwrite each file on disk with main's version (fs.writeFileSync
//         works on FUSE — it truncates in-place, no unlink)
//      c. Move HEAD pointer: `git symbolic-ref HEAD refs/heads/main`
//      d. Reset the index: `git read-tree main`
//      e. Verify: confirm `git rev-parse --abbrev-ref HEAD` === 'main'
//
//   3. BRANCH NAME SANITIZATION — Rom's DONE report provides the branch name
//      as untrusted input. Reject anything that isn't [a-zA-Z0-9._/-].
//
//   4. POST-MERGE VERIFICATION — after every merge, verify that the working
//      tree matches git's committed state. If not, overwrite disk from git.
// ---------------------------------------------------------------------------

const BRANCH_NAME_REGEX = /^[a-zA-Z0-9._\/-]+$/;

/**
 * @deprecated No longer called — PROJECT_DIR stays on main permanently with
 * worktree-based execution. Retained as dead code for safety.
 *
 * autoCommitDirtyTree(reason)
 *
 * If the working tree has uncommitted changes to tracked files, commit them
 * to the current branch. Returns true if a commit was made.
 *
 * Uses GIT_INDEX_FILE to avoid index.lock issues on FUSE.
 */
function autoCommitDirtyTree(reason) {
  try {
    const status = gitFinalizer.runGit('git status --porcelain', { slice_id: '0', op: 'autoCommit_status', encoding: 'utf-8' }).trim();
    // Only care about modified tracked files (M, D, R) — not untracked (??)
    const trackedChanges = status.split('\n').filter(l => l && !l.startsWith('??'));
    if (trackedChanges.length === 0) return false;

    const branch = gitFinalizer.runGit('git rev-parse --abbrev-ref HEAD', { slice_id: '0', op: 'autoCommit_branch', encoding: 'utf-8' }).trim();
    const msg = `autocommit: ${reason} [${trackedChanges.length} file(s) on ${branch}]`;
    log('warn', 'git_safety', { msg, files: trackedChanges.map(l => l.trim()).join(', ') });

    gitFinalizer.runGit('git add -u', { slice_id: '0', op: 'autoCommit_add', execOpts: { stdio: 'pipe' } });
    gitFinalizer.runGit(`git commit -m "${msg.replace(/"/g, '\\"')}"`, { slice_id: '0', op: 'autoCommit_commit', execOpts: { stdio: 'pipe' } });
    log('info', 'git_safety', { msg: `Auto-committed ${trackedChanges.length} files to ${branch}` });
    return true;
  } catch (err) {
    log('warn', 'git_safety', { msg: 'autoCommitDirtyTree failed', error: err.message });
    return false;
  }
}

/**
 * @deprecated No longer called — PROJECT_DIR stays on main permanently with
 * worktree-based execution. Retained as dead code for safety.
 *
 * fuseSafeCheckoutMain(id)
 *
 * FUSE-safe replacement for `git checkout main`. Never calls unlink.
 *
 * 1. If already on main with clean tree → no-op.
 * 2. Auto-commit any dirty tracked files to current branch.
 * 3. Overwrite each differing file on disk with main's version
 *    (fs.writeFileSync truncates in-place — works on FUSE).
 * 4. Remove files that exist on the current branch but not on main
 *    (via rename to trash — FUSE-safe).
 * 5. Move HEAD to main and reset the index.
 *
 * Throws on unrecoverable failure.
 */
function fuseSafeCheckoutMain(id) {
  const current = execSync('git rev-parse --abbrev-ref HEAD', { cwd: PROJECT_DIR, encoding: 'utf-8' }).trim();

  if (current === 'main') {
    // Already on main — just verify tree is clean.
    autoCommitDirtyTree('uncommitted changes on main before slice processing');
    return;
  }

  // Step 1: commit any dirty tracked files to the CURRENT branch (not main).
  autoCommitDirtyTree(`uncommitted changes on ${current} before switching to main`);

  // Step 2: get list of files that differ between current HEAD and main.
  let diffFiles = [];
  try {
    const raw = execSync('git diff --name-only HEAD main', { cwd: PROJECT_DIR, encoding: 'utf-8' }).trim();
    if (raw) diffFiles = raw.split('\n').filter(Boolean);
  } catch (err) {
    log('warn', 'git_safety', { id, msg: 'git diff --name-only failed', error: err.message });
  }

  // Step 3: overwrite each differing file on disk with main's version.
  // TRASH_DIR is a global constant initialized at startup.
  let overwritten = 0;
  let removed = 0;

  for (const file of diffFiles) {
    const diskPath = path.join(PROJECT_DIR, file);
    try {
      // Try to get main's version of this file
      const content = execSync(`git show main:${file}`, { cwd: PROJECT_DIR, encoding: 'buffer' });
      // Ensure parent directory exists (file might be in a new subdirectory on main)
      fs.mkdirSync(path.dirname(diskPath), { recursive: true });
      fs.writeFileSync(diskPath, content);
      overwritten++;
    } catch (_) {
      // File doesn't exist on main — it only exists on the current branch.
      // Rename to trash (FUSE-safe) so the working tree matches main.
      try {
        fs.renameSync(diskPath, path.join(TRASH_DIR, path.basename(file) + '.branch-cleanup'));
        removed++;
      } catch (__) {
        // If even rename fails, just leave it — it'll be untracked on main.
      }
    }
  }

  // Step 4: also handle files that exist on main but not on current branch (new on main).
  let mainOnlyFiles = [];
  try {
    const raw = execSync('git diff --name-only --diff-filter=A main HEAD', { cwd: PROJECT_DIR, encoding: 'utf-8' }).trim();
    if (raw) mainOnlyFiles = raw.split('\n').filter(Boolean);
  } catch (_) {}

  for (const file of mainOnlyFiles) {
    if (diffFiles.includes(file)) continue; // Already handled above
    const diskPath = path.join(PROJECT_DIR, file);
    try {
      const content = execSync(`git show main:${file}`, { cwd: PROJECT_DIR, encoding: 'buffer' });
      fs.mkdirSync(path.dirname(diskPath), { recursive: true });
      fs.writeFileSync(diskPath, content);
      overwritten++;
    } catch (_) {}
  }

  // Step 5: move HEAD pointer to main and reset index.
  execSync('git symbolic-ref HEAD refs/heads/main', { cwd: PROJECT_DIR, stdio: 'pipe' });
  execSync('git read-tree main', { cwd: PROJECT_DIR, stdio: 'pipe' });

  // Step 6: verify.
  const verify = execSync('git rev-parse --abbrev-ref HEAD', { cwd: PROJECT_DIR, encoding: 'utf-8' }).trim();
  if (verify !== 'main') {
    throw new Error(`fuseSafeCheckoutMain: HEAD is ${verify}, expected main`);
  }

  log('info', 'git_safety', {
    id,
    msg: `FUSE-safe checkout to main complete (was: ${current})`,
    filesOverwritten: overwritten,
    filesRemoved: removed,
    totalDiff: diffFiles.length,
  });
}

/**
 * @deprecated No longer called — worktrees replace checkout. Retained as dead
 * code for safety.
 *
 * fuseSafeCheckoutBranch(id, branchName)
 *
 * FUSE-safe checkout to an EXISTING feature branch.
 * Same strategy as fuseSafeCheckoutMain but targets a named branch.
 * Used for apendment flows where the orchestrator needs to resume work on
 * a branch after a restart (when HEAD may have returned to main).
 *
 * Steps:
 *   1. Auto-commit dirty tracked files.
 *   2. Diff current HEAD vs target branch.
 *   3. Overwrite each differing file via writeFileSync (truncate-in-place).
 *   4. Move HEAD to target branch via symbolic-ref + read-tree.
 *   5. Verify HEAD.
 */
function fuseSafeCheckoutBranch(id, branchName) {
  branchName = sanitizeBranchName(branchName);

  const current = execSync('git rev-parse --abbrev-ref HEAD', { cwd: PROJECT_DIR, encoding: 'utf-8' }).trim();
  if (current === branchName) {
    log('info', 'git_safety', { id, msg: `Already on branch ${branchName} — no checkout needed` });
    return;
  }

  // Verify the branch exists
  try {
    execSync(`git rev-parse --verify refs/heads/${branchName}`, { cwd: PROJECT_DIR, stdio: 'pipe' });
  } catch (_) {
    throw new Error(`fuseSafeCheckoutBranch: branch ${branchName} does not exist`);
  }

  // Step 1: commit anything dirty
  autoCommitDirtyTree(`pre-checkout-branch-${branchName}`);

  // Step 2: diff files between current HEAD and the target branch
  const diffRaw = execSync(`git diff --name-only HEAD ${branchName}`, { cwd: PROJECT_DIR, encoding: 'utf-8' }).trim();
  const diffFiles = diffRaw ? diffRaw.split('\n').filter(Boolean) : [];

  // Step 3: overwrite each file from the target branch
  let overwritten = 0;
  let removed = 0;
  for (const file of diffFiles) {
    const diskPath = path.join(PROJECT_DIR, file);
    try {
      const content = execSync(`git show ${branchName}:${file}`, { cwd: PROJECT_DIR, encoding: 'buffer' });
      const dir = path.dirname(diskPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(diskPath, content);
      overwritten++;
    } catch (_) {
      // File doesn't exist on target branch — move to trash
      if (fs.existsSync(diskPath)) {
        try { fs.renameSync(diskPath, path.join(TRASH_DIR, path.basename(file) + '.branch-checkout')); } catch (__) {}
        removed++;
      }
    }
  }

  // Step 4: move HEAD pointer
  execSync(`git symbolic-ref HEAD refs/heads/${branchName}`, { cwd: PROJECT_DIR, stdio: 'pipe' });
  execSync(`git read-tree ${branchName}`, { cwd: PROJECT_DIR, stdio: 'pipe' });

  // Step 5: verify
  const verify = execSync('git rev-parse --abbrev-ref HEAD', { cwd: PROJECT_DIR, encoding: 'utf-8' }).trim();
  if (verify !== branchName) {
    throw new Error(`fuseSafeCheckoutBranch: HEAD is ${verify}, expected ${branchName}`);
  }

  log('info', 'git_safety', {
    id,
    msg: `FUSE-safe checkout to branch ${branchName} complete (was: ${current})`,
    filesOverwritten: overwritten,
    filesRemoved: removed,
    totalDiff: diffFiles.length,
  });
}

/**
 * @deprecated Replaced by createWorktree(). Retained as dead code for safety.
 *
 * createBranchFromMain(id, branchName)
 *
 * Watcher-owned branch creation. Creates a new branch from main HEAD.
 * Since we're branching from the currently checked-out main, no files
 * change on disk — this is inherently FUSE-safe (just pointer creation).
 *
 * Pre-condition: HEAD must be on main (call fuseSafeCheckoutMain first).
 */
function createBranchFromMain(id, branchName) {
  branchName = sanitizeBranchName(branchName);

  // Verify we're on main
  const current = execSync('git rev-parse --abbrev-ref HEAD', { cwd: PROJECT_DIR, encoding: 'utf-8' }).trim();
  if (current !== 'main') {
    throw new Error(`createBranchFromMain: expected HEAD on main, got ${current}`);
  }

  // Check if branch already exists
  try {
    execSync(`git rev-parse --verify refs/heads/${branchName}`, { cwd: PROJECT_DIR, stdio: 'pipe' });
    // Branch exists — just check it out
    log('info', 'git_safety', { id, msg: `Branch ${branchName} already exists — checking out` });
    fuseSafeCheckoutBranch(id, branchName);
    return;
  } catch (_) {
    // Branch doesn't exist — good, create it
  }

  // Create branch (just moves pointer, no file changes since we're on main)
  execSync(`git checkout -b ${branchName}`, { cwd: PROJECT_DIR, stdio: 'pipe' });

  // Verify
  const verify = execSync('git rev-parse --abbrev-ref HEAD', { cwd: PROJECT_DIR, encoding: 'utf-8' }).trim();
  if (verify !== branchName) {
    throw new Error(`createBranchFromMain: HEAD is ${verify}, expected ${branchName}`);
  }

  log('info', 'git_safety', { id, msg: `Created branch ${branchName} from main`, sha: execSync('git rev-parse HEAD', { cwd: PROJECT_DIR, encoding: 'utf-8' }).trim() });
}

/**
 * verifyBranchState(id, expectedBranch)
 *
 * Post-invocation gate. Verifies that:
 *   1. HEAD is on the expected branch (not main, not detached).
 *   2. The branch has commits ahead of main (Rom actually did work).
 *   3. The branch's base is reachable from main (not forked from stale state).
 *
 * Returns { ok, issues[] }.
 */
function verifyBranchState(id, expectedBranch, cwd) {
  cwd = cwd || PROJECT_DIR;
  const issues = [];

  // Check 1: correct branch
  const current = gitFinalizer.runGit('git rev-parse --abbrev-ref HEAD', { slice_id: id || '0', op: 'verifyBranch_head', cwd, encoding: 'utf-8' }).trim();
  if (current !== expectedBranch) {
    issues.push(`HEAD is on '${current}', expected '${expectedBranch}'`);
  }

  // Check 2: commits ahead of main
  try {
    const ahead = gitFinalizer.runGit(`git rev-list main..${expectedBranch} --count`, { slice_id: id || '0', op: 'verifyBranch_ahead', cwd, encoding: 'utf-8' }).trim();
    if (parseInt(ahead, 10) === 0) {
      issues.push(`Branch ${expectedBranch} has no commits ahead of main`);
    }
  } catch (_) {
    issues.push(`Could not count commits ahead of main for ${expectedBranch}`);
  }

  // Check 3: merge-base is on main (branch forked from main, not from some other branch)
  try {
    const mergeBase = gitFinalizer.runGit(`git merge-base main ${expectedBranch}`, { slice_id: id || '0', op: 'verifyBranch_mergeBase', cwd, encoding: 'utf-8' }).trim();
    const mainTip   = gitFinalizer.runGit('git rev-parse main', { slice_id: id || '0', op: 'verifyBranch_mainTip', cwd, encoding: 'utf-8' }).trim();
    // The merge-base should be the main tip at branch creation time.
    // Verify it's reachable from main.
    const isOnMain = gitFinalizer.runGit(`git branch --contains ${mergeBase}`, { slice_id: id || '0', op: 'verifyBranch_contains', cwd, encoding: 'utf-8' });
    if (!isOnMain.includes('main')) {
      issues.push(`Branch merge-base ${mergeBase.slice(0,8)} is not on main — possible stale fork`);
    }
  } catch (_) {
    issues.push('Could not verify merge-base');
  }

  const ok = issues.length === 0;
  if (!ok) {
    log('warn', 'git_safety', { id, msg: 'Post-invocation branch verification failed', issues });
  } else {
    log('info', 'git_safety', { id, msg: `Post-invocation branch verification passed for ${expectedBranch}` });
  }
  return { ok, issues };
}

/**
 * clearStaleGitLocks()
 *
 * Removes git lock files that may have been left by a prior crash.
 * Safe to call unconditionally at startup — git creates these atomically
 * and a missing lock file is equivalent to no lock.
 */
function clearStaleGitLocks() {
  const lockFiles = [
    path.join(PROJECT_DIR, '.git', 'index.lock'),
    path.join(PROJECT_DIR, '.git', 'MERGE_HEAD'),
    path.join(PROJECT_DIR, '.git', 'MERGE_MSG'),
    path.join(PROJECT_DIR, '.git', 'MERGE_MODE'),
    path.join(PROJECT_DIR, '.git', 'ORIG_HEAD.lock'),
    path.join(PROJECT_DIR, '.git', 'COMMIT_EDITMSG.lock'),
  ];
  for (const f of lockFiles) {
    try {
      if (fs.existsSync(f)) {
        fs.unlinkSync(f);
        log('info', 'startup', { msg: `Removed stale git lock: ${path.basename(f)}` });
      }
    } catch (err) {
      log('warn', 'startup', { msg: `Could not remove stale lock ${path.basename(f)}`, error: err.message });
    }
  }
  // If there was a stuck merge, abort it
  try {
    gitFinalizer.runGit('git merge --abort', { slice_id: '0', op: 'clearStaleLocks_mergeAbort', execOpts: { stdio: 'pipe' } });
    log('info', 'startup', { msg: 'Aborted in-progress merge left from prior run' });
  } catch (_) {
    // No merge in progress — expected
  }
}

/**
 * selfRestart(reason)
 *
 * Spawns a fresh copy of the orchestrator process and exits this one.
 * Used when a hard-reset or lock-clearing operation needs a clean process state.
 */
function selfRestart(reason) {
  log('warn', 'self_restart', { msg: `Restarting orchestrator: ${reason}` });
  const { spawn } = require('child_process');
  const child = spawn(process.execPath, process.argv.slice(1), {
    detached: true,
    stdio: 'inherit',
    cwd: process.cwd(),
  });
  child.unref();
  process.exit(0);
}

/**
 * ensureMainIsFresh(id)
 *
 * Fetches from origin and synchronises local main so the branch we're
 * about to create includes all remote work. If the fetch fails (offline,
 * no remote), log a warning but continue — local main is still valid.
 *
 * Four cases after fetch:
 *   in-sync  (ahead=0, behind=0) → nothing to do
 *   ahead    (ahead>0, behind=0) → push local commits to origin
 *   behind   (ahead=0, behind>0) → fast-forward local main from origin
 *   diverged (ahead>0, behind>0) → throw Error; operator must resolve
 *
 * The push/ff paths are wrapped in the Layer-2 unlock/relock protocol
 * inherited from slice 202. True divergence bails before any unlock.
 */
function ensureMainIsFresh(id) {
  try {
    gitFinalizer.runGit('git fetch origin main', { slice_id: id, op: 'ensureMainIsFresh_fetch', execOpts: { stdio: 'pipe', timeout: 15000 } });
  } catch (err) {
    log('warn', 'git_safety', { id, msg: 'fetch origin/main failed — proceeding with local main', error: err.message });
    return;
  }

  const local  = gitFinalizer.runGit('git rev-parse main',        { slice_id: id, op: 'ensureMainIsFresh_localSha', encoding: 'utf-8' }).trim();
  const remote = gitFinalizer.runGit('git rev-parse origin/main', { slice_id: id, op: 'ensureMainIsFresh_remoteSha', encoding: 'utf-8' }).trim();

  if (local === remote) {
    log('info', 'git_safety', { id, msg: 'main is up to date with origin' });
    return;
  }

  const aheadCount  = Number(gitFinalizer.runGit('git rev-list --count origin/main..main',        { slice_id: id, op: 'ensureMainIsFresh_aheadCount',  encoding: 'utf-8' }).trim());
  const behindCount = Number(gitFinalizer.runGit('git rev-list --count main..origin/main',        { slice_id: id, op: 'ensureMainIsFresh_behindCount', encoding: 'utf-8' }).trim());

  // True divergence: local has commits origin doesn't AND origin has commits local doesn't.
  // This is an operator situation — bail immediately without touching either side.
  if (aheadCount > 0 && behindCount > 0) {
    log('error', 'git_safety', { id, msg: 'true divergence detected', ahead: aheadCount, behind: behindCount });
    throw new Error(`main diverged from origin: local ahead ${aheadCount}, behind ${behindCount}. Operator intervention required.`);
  }

  // ── Layer 2 enforcement: unlock source paths before git mutations, re-lock after ──
  const unlockScript = path.join(PROJECT_DIR, 'scripts', 'unlock-main.sh');
  const lockScript   = path.join(PROJECT_DIR, 'scripts', 'lock-main.sh');
  try { execSync(`bash "${unlockScript}"`, { cwd: PROJECT_DIR, stdio: 'pipe' }); } catch (_) {}

  try {
    if (aheadCount > 0 && behindCount === 0) {
      // Local ahead only — push to origin; do NOT reset
      log('info', 'git_safety', { id, msg: `local ahead of origin by ${aheadCount}; pushing`, ahead: aheadCount });
      gitFinalizer.runGit('git push origin main', { slice_id: id, op: 'ensureMainIsFresh_push', execOpts: { stdio: 'pipe' } });
      const after = gitFinalizer.runGit('git rev-parse main', { slice_id: id, op: 'ensureMainIsFresh_verifyPush', encoding: 'utf-8' }).trim();
      registerEvent(id, 'MAIN_PUSHED_TO_ORIGIN', { sha: after, ahead_count: aheadCount });
      log('info', 'git_safety', { id, msg: `Pushed main to origin: ${after.slice(0, 8)}, ${aheadCount} commit(s)` });
    } else {
      // Local behind only — safe fast-forward (aheadCount === 0, behindCount > 0)
      gitFinalizer.runGit('git merge --ff-only origin/main', { slice_id: id, op: 'ensureMainIsFresh_ff', execOpts: { stdio: 'pipe' } });
      const after = gitFinalizer.runGit('git rev-parse main', { slice_id: id, op: 'ensureMainIsFresh_verifyFF', encoding: 'utf-8' }).trim();
      log('info', 'git_safety', { id, msg: `Fast-forwarded main: ${local.slice(0, 8)} → ${after.slice(0, 8)}` });
    }
  } finally {
    try { execSync(`bash "${lockScript}"`, { cwd: PROJECT_DIR, stdio: 'pipe' }); } catch (_) {}
  }
}

/**
 * buildScopeDiff(id, branchName, sliceContent)
 *
 * Builds a human-readable scope summary for Nog's review:
 *   - Which files were changed, added, or deleted on the branch
 *   - Per-file line count deltas
 *   - The slice's title and goal for scope comparison
 *
 * Returns a string block to inject into the evaluator prompt.
 */
function buildScopeDiff(id, branchName, sliceContent) {
  const lines = [];
  try {
    // File-level diff stat (which files changed and by how much)
    const stat = gitFinalizer.runGit(`git diff --stat main...${branchName}`, { slice_id: id, op: 'buildScopeDiff_stat', encoding: 'utf-8' }).trim();
    // File list with status (A=added, M=modified, D=deleted)
    const nameStatus = gitFinalizer.runGit(`git diff --name-status main...${branchName}`, { slice_id: id, op: 'buildScopeDiff_nameStatus', encoding: 'utf-8' }).trim();

    lines.push('## SCOPE REVIEW — files changed on this branch');
    lines.push('');
    lines.push('```');
    lines.push(nameStatus);
    lines.push('```');
    lines.push('');
    lines.push('Summary:');
    lines.push('```');
    lines.push(stat.split('\n').slice(-1)[0] || '(no changes)');  // last line = totals
    lines.push('```');
    lines.push('');

    // Extract slice scope info
    const meta = parseFrontmatter(sliceContent) || {};
    lines.push(`Slice title: ${meta.title || '(unknown)'}`);
    lines.push(`Slice goal: ${meta.goal || '(unknown)'}`);
    lines.push(`Branch: ${branchName}`);
    lines.push('');
  } catch (err) {
    lines.push('## SCOPE REVIEW — could not generate diff');
    lines.push(`Error: ${err.message}`);
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * sanitizeBranchName(name)
 *
 * Validates that a branch name from Rom's DONE report is safe for shell
 * interpolation. Returns the name if valid, throws if not.
 */
function sanitizeBranchName(name) {
  if (!name || typeof name !== 'string') {
    throw new Error('Branch name is missing or not a string');
  }
  if (!BRANCH_NAME_REGEX.test(name)) {
    throw new Error(`Invalid branch name: "${name}" — must match ${BRANCH_NAME_REGEX}`);
  }
  if (name.includes('..') || name.startsWith('-')) {
    throw new Error(`Invalid branch name: "${name}" — contains unsafe pattern`);
  }
  return name;
}

// ---------------------------------------------------------------------------
// Worktree management
// ---------------------------------------------------------------------------

/**
 * getWorktreePath(id)
 *
 * Returns the deterministic worktree path for a given slice ID.
 */
function getWorktreePath(id) {
  return path.join(WORKTREE_BASE, String(id));
}

/**
 * createWorktree(id, branchName)
 *
 * Creates a git worktree at /tmp/ds9-worktrees/{id}/ for the given branch.
 * For new slices: creates a new branch from main.
 * For apendments: checks out the existing branch.
 * If a worktree already exists for this ID (requeue reuse), returns it.
 * If the branch is already checked out in another worktree, prunes the old one.
 *
 * Returns the worktree path. Throws on failure.
 */
function createWorktree(id, branchName) {
  branchName = sanitizeBranchName(branchName);
  const wtPath = getWorktreePath(id);

  // If this ID already has a worktree, reuse it (Part 6: rejection requeue reuse)
  if (fs.existsSync(wtPath)) {
    log('info', 'worktree', { id, msg: `Reusing existing worktree at ${wtPath}`, branch: branchName });
    return wtPath;
  }

  // Ensure base dir exists
  fs.mkdirSync(WORKTREE_BASE, { recursive: true });

  // Check if branch already exists
  let branchExists = false;
  try {
    gitFinalizer.runGit(`git rev-parse --verify refs/heads/${branchName}`, { slice_id: id, op: 'createWorktree_branchCheck', execOpts: { stdio: 'pipe' } });
    branchExists = true;
  } catch (_) {}

  if (branchExists) {
    // Branch exists — check if it's already in another worktree and prune if needed
    try {
      const wtList = gitFinalizer.runGit('git worktree list --porcelain', { slice_id: id, op: 'createWorktree_listCheck', encoding: 'utf-8' });
      const blocks = wtList.split('\n\n').filter(Boolean);
      for (const block of blocks) {
        const lines = block.split('\n');
        const wtLine = lines.find(l => l.startsWith('worktree '));
        const brLine = lines.find(l => l.startsWith('branch '));
        if (wtLine && brLine && brLine === `branch refs/heads/${branchName}`) {
          const oldPath = wtLine.replace('worktree ', '');
          if (oldPath !== PROJECT_DIR) {
            try { fs.rmSync(oldPath, { recursive: true, force: true }); } catch (_) {}
            gitFinalizer.runGit('git worktree prune', { slice_id: id, op: 'createWorktree_prune', execOpts: { stdio: 'pipe' } });
            log('info', 'worktree', { id, msg: `Pruned stale worktree at ${oldPath} for branch ${branchName}` });
          }
        }
      }
    } catch (_) {}

    // Existing branch (apendment or retry)
    gitFinalizer.runGit(`git worktree add "${wtPath}" ${branchName}`, { slice_id: id, op: 'createWorktree', execOpts: { stdio: 'pipe' }, worktreePath: wtPath });
  } else {
    // New branch from main
    gitFinalizer.runGit(`git worktree add "${wtPath}" -b ${branchName} main`, { slice_id: id, op: 'createWorktree', execOpts: { stdio: 'pipe' }, worktreePath: wtPath });
  }

  registerEvent(id, 'WORKTREE_CREATED', { path: wtPath, branch: branchName });
  log('info', 'worktree', { id, msg: `Created worktree at ${wtPath} on branch ${branchName}`, branchExists });
  return wtPath;
}

/**
 * cleanupWorktree(id, branchName)
 *
 * FUSE-safe worktree cleanup:
 *   1. rm -rf /tmp/ds9-worktrees/{id} (local FS, no FUSE issue)
 *   2. Rename .git/worktrees/{id}/ to .dead suffix (FUSE-safe)
 *   3. Rename branch ref to .dead suffix (FUSE-safe)
 */
function cleanupWorktree(id, branchName) {
  const wtPath = getWorktreePath(id);

  // Step 1: remove worktree directory (local FS — no FUSE)
  try {
    fs.rmSync(wtPath, { recursive: true, force: true });
  } catch (err) {
    log('warn', 'worktree', { id, msg: 'Failed to remove worktree dir', error: err.message });
  }

  // Prune so git knows the worktree is gone
  try {
    gitFinalizer.runGit('git worktree prune', { slice_id: id, op: 'cleanupWorktree', execOpts: { stdio: 'pipe' } });
  } catch (_) {}

  // Step 2: FUSE-safe cleanup of .git/worktrees/{id}/
  const gitWorktreeDir = path.join(PROJECT_DIR, '.git', 'worktrees', String(id));
  if (fs.existsSync(gitWorktreeDir)) {
    try {
      fs.renameSync(gitWorktreeDir, gitWorktreeDir + '.dead');
    } catch (err) {
      log('warn', 'worktree', { id, msg: 'Failed to rename .git/worktrees entry to .dead', error: err.message });
    }
  }

  // Step 3: FUSE-safe cleanup of branch ref
  if (branchName) {
    try {
      branchName = sanitizeBranchName(branchName);
      const refPath = path.join(PROJECT_DIR, '.git', 'refs', 'heads', ...branchName.split('/'));
      if (fs.existsSync(refPath)) {
        fs.renameSync(refPath, refPath + '.dead');
      }
    } catch (err) {
      log('warn', 'worktree', { id, msg: 'Failed to rename branch ref to .dead', error: err.message });
    }
  }

  registerEvent(id, 'WORKTREE_REMOVED', { path: wtPath });
  log('info', 'worktree', { id, msg: `Cleaned up worktree for slice ${id}` });
}

/**
 * isRomSelfTerminated(reason)
 *
 * Returns true for any of the 4 classified rom-self-termination reasons
 * AND for the legacy 'no_report' string (historical register events).
 */
function isRomSelfTerminated(reason) {
  return reason === 'no_report' ||
    reason === 'rom_self_terminated_empty' ||
    reason === 'rom_self_terminated_uncommitted' ||
    reason === 'rom_self_terminated_committed' ||
    reason === 'rom_self_terminated_mixed';
}

/**
 * classifyNoReportExit(id, worktreePath, branchName)
 *
 * Inspects git state in the worktree to classify why Rom exited without a
 * DONE file. Returns { reason, hasCommits, hasDiff, commits, diffSummary, porcelain }.
 */
function classifyNoReportExit(id, worktreePath, branchName) {
  const result = { reason: 'rom_self_terminated_empty', hasCommits: false, hasDiff: false, commits: [], diffSummary: '', porcelain: '' };

  if (!fs.existsSync(worktreePath)) {
    log('warn', 'worktree', { id, msg: 'classifyNoReportExit: worktree dir missing — treating as empty' });
    return result;
  }

  // Check for commits beyond main
  try {
    const logOutput = gitFinalizer.runGit(`git log main..${branchName} --oneline`, { slice_id: id, op: 'classifyNoReport_log', cwd: worktreePath, encoding: 'utf-8', execOpts: { stdio: ['pipe', 'pipe', 'pipe'] } }).trim();
    if (logOutput) {
      result.hasCommits = true;
      result.commits = logOutput.split('\n');
    }
  } catch (_) {}

  // Check for uncommitted changes
  try {
    result.porcelain = gitFinalizer.runGit('git status --porcelain', { slice_id: id, op: 'classifyNoReport_status', cwd: worktreePath, encoding: 'utf-8', execOpts: { stdio: ['pipe', 'pipe', 'pipe'] } }).trim();
    if (result.porcelain) {
      result.hasDiff = true;
    }
  } catch (_) {}

  // Get diff summary (truncated)
  try {
    const diff = gitFinalizer.runGit('git diff HEAD', { slice_id: id, op: 'classifyNoReport_diff', cwd: worktreePath, encoding: 'utf-8', execOpts: { stdio: ['pipe', 'pipe', 'pipe'] } });
    const lines = diff.split('\n');
    result.diffSummary = lines.slice(0, 200).join('\n') + (lines.length > 200 ? '\n…(truncated)' : '');
  } catch (_) {}

  // Classify
  if (result.hasCommits && result.hasDiff) {
    result.reason = 'rom_self_terminated_mixed';
  } else if (result.hasCommits) {
    result.reason = 'rom_self_terminated_committed';
  } else if (result.hasDiff) {
    result.reason = 'rom_self_terminated_uncommitted';
  }
  // else: remains rom_self_terminated_empty

  return result;
}

/**
 * rescueWorktree(id, branchName, classification, stdout, stderr)
 *
 * Moves the worktree to bridge/worktree-rescue/<id>/ instead of wiping it.
 * Writes a RESCUE.md summary. For committed/mixed classifications, preserves
 * the branch ref. Returns the rescue path.
 */
function rescueWorktree(id, branchName, classification, stdout, stderr) {
  const rescueBase = path.join(PROJECT_DIR, 'bridge', 'worktree-rescue');
  fs.mkdirSync(rescueBase, { recursive: true });

  let rescuePath = path.join(rescueBase, String(id));
  if (fs.existsSync(rescuePath)) {
    rescuePath = `${rescuePath}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  }

  const wtPath = getWorktreePath(id);

  // Move worktree directory to rescue location
  try {
    fs.renameSync(wtPath, rescuePath);
  } catch (err) {
    log('error', 'worktree', { id, msg: `rescueWorktree: failed to move worktree to ${rescuePath}`, error: err.message });
    return null;
  }

  // Prune git worktree registry (the dir is gone from its original location)
  try { gitFinalizer.runGit('git worktree prune', { slice_id: id, op: 'rescueWorktree', execOpts: { stdio: 'pipe' } }); } catch (_) {}

  // For empty/uncommitted (no commits on branch), clean up branch ref
  if (!classification.hasCommits && branchName) {
    try {
      branchName = sanitizeBranchName(branchName);
      const refPath = path.join(PROJECT_DIR, '.git', 'refs', 'heads', ...branchName.split('/'));
      if (fs.existsSync(refPath)) {
        fs.renameSync(refPath, refPath + '.dead');
      }
    } catch (_) {}
  }
  // For committed/mixed: keep branch ref alive

  // Write RESCUE.md summary
  const truncate = (s, n) => (s && s.length > n ? '…' + s.slice(-n) : s || '(empty)');
  const rescueMd = [
    '---',
    `id: "${id}"`,
    `rescued: "${new Date().toISOString()}"`,
    `reason: "${classification.reason}"`,
    `has_commits: ${classification.hasCommits}`,
    `has_diff: ${classification.hasDiff}`,
    '---',
    '',
    '## Commits (main..slice)',
    '```',
    classification.commits.length ? classification.commits.join('\n') : '(none)',
    '```',
    '',
    '## Git status --porcelain',
    '```',
    classification.porcelain || '(clean)',
    '```',
    '',
    '## Diff summary (first 200 lines)',
    '```diff',
    classification.diffSummary || '(none)',
    '```',
    '',
    '## Stdout tail',
    '```',
    truncate(stdout, 500),
    '```',
    '',
    '## Stderr tail',
    '```',
    truncate(stderr, 500),
    '```',
  ].join('\n');

  try {
    fs.writeFileSync(path.join(rescuePath, 'RESCUE.md'), rescueMd, 'utf8');
  } catch (err) {
    log('warn', 'worktree', { id, msg: 'Failed to write RESCUE.md', error: err.message });
  }

  log('info', 'worktree', { id, msg: `Rescued worktree to ${rescuePath}`, reason: classification.reason });
  return rescuePath;
}

/**
 * verifyRomActuallyWorked(id, branchName, actualDurationMs, actualTokensOut)
 *
 * Checks that Rom's claimed DONE report corresponds to real work on the slice
 * branch. Primary gate: commit count. Advisory: metrics divergence.
 *
 * Returns { ok: true } or { ok: false, reason: 'rom_no_commits', detail: '...' }.
 */
function verifyRomActuallyWorked(id, branchName, actualDurationMs, actualTokensOut) {
  // Count commits ahead of main on the slice branch
  let commitCount = 0;
  try {
    const countStr = gitFinalizer.runGit(`git rev-list ${branchName} ^main --count`, {
      slice_id: id, op: 'verifyRomWork_revList', encoding: 'utf-8',
      execOpts: { stdio: ['pipe', 'pipe', 'pipe'] },
    }).trim();
    commitCount = parseInt(countStr, 10) || 0;
  } catch (err) {
    log('warn', 'rom_verify', { id, msg: 'git rev-list failed during verification — skipping commit check', error: err.message });
    return { ok: true };
  }

  // Read DONE frontmatter for claimed metrics
  let claimedTokensOut = 0;
  let claimedElapsedMs = 0;
  try {
    const doneContent = fs.readFileSync(path.join(QUEUE_DIR, `${id}-DONE.md`), 'utf-8');
    const meta = parseFrontmatter(doneContent);
    if (meta) {
      claimedTokensOut = parseInt(meta.tokens_out, 10) || 0;
      claimedElapsedMs = parseInt(meta.elapsed_ms, 10) || 0;
    }
  } catch (_) {}

  // Primary gate: skeleton-only branch with substantive claims
  if (commitCount <= 1 && claimedTokensOut > 1000) {
    return {
      ok: false,
      reason: 'rom_no_commits',
      detail: `claimed tokens_out=${claimedTokensOut} but ${branchName} has only ${commitCount} commit(s) past main (skeleton only)`,
    };
  }

  // Advisory: metrics divergence (soft flag, not blocking)
  if (actualTokensOut && claimedTokensOut > 10 * actualTokensOut) {
    log('warn', 'rom_verify', {
      id,
      msg: 'Metrics divergence detected (>10× claimed vs actual tokens_out) — soft flag only',
      claimedTokensOut,
      actualTokensOut,
      ratio: Math.round(claimedTokensOut / actualTokensOut),
    });
  }

  return { ok: true };
}

/**
 * cleanupDeadWorktrees()
 *
 * Startup scan: removes .dead entries left by cleanupWorktree from a prior
 * session that couldn't fully delete due to FUSE constraints.
 */
function cleanupDeadWorktrees() {
  // Clean .dead entries from .git/worktrees/
  const worktreesDir = path.join(PROJECT_DIR, '.git', 'worktrees');
  try {
    const entries = fs.readdirSync(worktreesDir);
    for (const entry of entries) {
      if (entry.endsWith('.dead')) {
        try {
          fs.rmSync(path.join(worktreesDir, entry), { recursive: true, force: true });
          log('info', 'worktree', { msg: `Startup: cleaned dead worktree entry ${entry}` });
        } catch (_) {}
      }
    }
  } catch (_) {}

  // Clean .dead entries from .git/refs/heads/slice/
  const sliceRefsDir = path.join(PROJECT_DIR, '.git', 'refs', 'heads', 'slice');
  try {
    const entries = fs.readdirSync(sliceRefsDir);
    for (const entry of entries) {
      if (entry.endsWith('.dead')) {
        try {
          fs.unlinkSync(path.join(sliceRefsDir, entry));
          log('info', 'worktree', { msg: `Startup: cleaned dead branch ref slice/${entry}` });
        } catch (_) {}
      }
    }
  } catch (_) {}

  // Clean up any leftover worktree dirs in /tmp from crashed sessions
  try {
    if (fs.existsSync(WORKTREE_BASE)) {
      const dirs = fs.readdirSync(WORKTREE_BASE);
      for (const dir of dirs) {
        const wtDir = path.join(WORKTREE_BASE, dir);
        // Check if this worktree is still registered with git
        try {
          const wtList = gitFinalizer.runGit('git worktree list --porcelain', { slice_id: '0', op: 'cleanupDead_wtList', encoding: 'utf-8' });
          if (!wtList.includes(wtDir)) {
            fs.rmSync(wtDir, { recursive: true, force: true });
            log('info', 'worktree', { msg: `Startup: cleaned orphaned worktree dir ${dir}` });
          }
        } catch (_) {}
      }
    }
  } catch (_) {}
}

/**
 * verifyWorkingTreeMatchesMain(id, context)
 *
 * After a merge or checkout, verify the working tree has no unexpected
 * differences from git's committed state. If it does, overwrite disk.
 *
 * This catches FUSE-induced partial updates (git wrote some files but
 * couldn't unlink others).
 */
function verifyWorkingTreeMatchesMain(id, context) {
  try {
    const dirty = gitFinalizer.runGit('git diff --name-only HEAD', { slice_id: id, op: 'verifyTree_diff', encoding: 'utf-8' }).trim();
    if (!dirty) return; // Clean — all good.

    const files = dirty.split('\n').filter(Boolean);
    log('warn', 'git_safety', {
      id,
      msg: `Post-${context} verification: ${files.length} files differ from committed state — overwriting disk`,
      files: files.join(', '),
    });

    for (const file of files) {
      const diskPath = path.join(PROJECT_DIR, file);
      try {
        const content = gitFinalizer.runGit(`git show HEAD:${file}`, { slice_id: id, op: 'verifyTree_show', execOpts: { encoding: 'buffer' } });
        fs.writeFileSync(diskPath, content);
      } catch (_) {
        // File was deleted in git — rename to trash
        try { fs.renameSync(diskPath, path.join(TRASH_DIR, path.basename(file) + '.verify-cleanup')); } catch (__) {}
      }
    }
  } catch (err) {
    log('warn', 'git_safety', { id, msg: `Post-${context} verification failed`, error: err.message });
  }
}

// ---------------------------------------------------------------------------
// Heartbeat
// ---------------------------------------------------------------------------

let heartbeatState = {
  status: 'idle',
  current_slice: null,
  current_slice_title: null,
  current_slice_goal: null,
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
    current_slice: heartbeatState.current_slice,
    current_slice_title: heartbeatState.current_slice_title,
    current_slice_goal: heartbeatState.current_slice_goal,
    slice_elapsed_seconds: elapsedSeconds,
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
let sessionHasProcessed = false;

// ---------------------------------------------------------------------------
// Active child process tracking — keyed by slice ID.
// Used by pause/resume/abort control actions.
// ---------------------------------------------------------------------------

const activeChildren = new Map(); // Map<sliceId: string, { child: ChildProcess, worktreePath: string }>

// ---------------------------------------------------------------------------
// Rom invocation
// ---------------------------------------------------------------------------

/**
 * invokeRom(sliceContent, donePath, inProgressPath, errorPath, id, effectiveTimeoutMs)
 *
 * Pipes slice content + report path instruction to `claude -p`.
 * On success: checks donePath exists; if not, writes a fallback ERROR report.
 * On failure: writes an ERROR report.
 * Always cleans up the IN_PROGRESS file on completion (existence-checked to
 * avoid ENOENT when Rom's crash recovery already handled it).
 */
function invokeRom(sliceContent, donePath, inProgressPath, errorPath, id, effectiveInactivityMs, title, goal) {
  // ── WATCHER-OWNED BRANCH LIFECYCLE ─────────────────────────────────────
  // The orchestrator OWNS all branching. Rom never creates, checks out, or manages
  // branches. This is the rigid pipeline gate that prevents prompt-quality
  // failures from corrupting git state.
  //
  // New slices:  main → create slice/{id} branch → invoke Rom on that branch
  // Apendments:  checkout existing branch → invoke Rom on that branch
  // ──────────────────────────────────────────────────────────────────────────
  const sliceMeta = parseFrontmatter(sliceContent) || {};
  const isApendment = !!(sliceMeta.apendment || sliceMeta.amendment || (sliceMeta.references && sliceMeta.references !== 'null') || (parseInt(sliceMeta.round, 10) > 1));
  const sliceBranch = isApendment
    ? (sliceMeta.apendment || sliceMeta.amendment || sliceMeta.branch || `slice/${sliceMeta.root_commission_id || id}`)
    : `slice/${id}`;

  // ── WORKTREE-BASED BRANCH LIFECYCLE ──────────────────────────────────────
  // Each slice gets its own git worktree at /tmp/ds9-worktrees/{id}/.
  // PROJECT_DIR stays on main permanently. The dashboard is never affected.
  //
  // New slices:  create worktree with new branch from main
  // Apendments:  create worktree on existing branch (prunes old worktree if needed)
  // ──────────────────────────────────────────────────────────────────────────
  let worktreePath;
  try {
    ensureMainIsFresh(id);
    worktreePath = gitFinalizer.createWorktreeWithRetry(createWorktree, id, sliceBranch);
    log('info', 'branch', { id, msg: `Worktree ready at ${worktreePath} on branch ${sliceBranch}`, isApendment });
  } catch (err) {
    // If retry exhaustion enriched the error, use the stale reason
    const reason = err.retryReason
      ? err.retryReason
      : (isApendment ? 'apendment_branch_checkout_failed' : 'branch_creation_failed');
    const extraFields = err.lockInfo || {};
    log('error', 'branch', { id, msg: `Failed to create worktree for ${sliceBranch} — aborting invocation`, error: err.message, reason });
    const errorPath2 = path.join(QUEUE_DIR, `${id}-ERROR.md`);
    writeErrorFile(errorPath2, id, reason, err, '', '', extraFields);
    log('info', 'state', { id, from: 'IN_PROGRESS', to: 'ERROR', reason });
    registerEvent(id, 'ERROR', {
      reason,
      phase: 'worktree_setup',
      command: `git worktree add … ${sliceBranch}`,
      exit_code: err.status != null ? err.status : null,
      stderr_tail: truncStderr(err.stderr ? err.stderr.toString() : err.message),
    });
    appendKiraEvent({
      event: 'ERROR',
      slice_id: id,
      root_id: sliceMeta.root_commission_id || null,
      cycle: null,
      branch: sliceBranch || null,
      details: `Slice ${id} errored: ${reason}`,
    });
    processing = false;
    heartbeatState.status = 'idle';
    heartbeatState.current_slice = null;
    heartbeatState.current_slice_title = null;
    heartbeatState.current_slice_goal = null;
    heartbeatState.pickupTime = null;
    writeHeartbeat();
    return;
  }

  // Ensure the worktree has a queue directory for the DONE report
  const worktreeQueueDir = path.join(worktreePath, 'bridge', 'queue');
  fs.mkdirSync(worktreeQueueDir, { recursive: true });
  const worktreeDonePath = path.join(worktreeQueueDir, `${id}-DONE.md`);

  const doneTemplate = [
    '',
    '## DONE report template',
    '',
    'Write your report to: ' + worktreeDonePath,
    '',
    'Use this exact frontmatter structure (fill in real values):',
    '',
    '```',
    '---',
    'id: "' + id + '"',
    'title: "(slice title)"',
    'from: rom',
    'to: nog',
    'status: DONE',
    'slice_id: "' + id + '"',
    'branch: "' + sliceBranch + '"',
    'completed: "' + new Date().toISOString() + '"',
    'tokens_in: 0',
    'tokens_out: 0',
    'elapsed_ms: 0',
    'estimated_human_hours: 0.0',
    'compaction_occurred: false',
    '---',
    '```',
    '',
    'REQUIRED: All five metrics fields (tokens_in, tokens_out, elapsed_ms, estimated_human_hours, compaction_occurred) must have real, non-zero values. Missing or zero metrics will cause ERROR with reason "incomplete_metrics".',
    '- tokens_in: integer, total input tokens consumed this session',
    '- tokens_out: integer, total output tokens generated this session',
    '- elapsed_ms: integer, wall-clock milliseconds from pickup to DONE',
    '- estimated_human_hours: float, your judgment of how long a skilled human developer would take',
    '- compaction_occurred: boolean, true if your context window compacted mid-session',
    '- completed: must be full ISO 8601 UTC datetime (e.g. "2026-04-12T01:22:40.000Z"), never date-only',
  ].join('\n');

  const prompt = sliceContent + doneTemplate;

  const pickupTime = Date.now();

  // Activity tracking: updated whenever the child writes to stdout or stderr.
  // killedByInactivity is set to true before we manually kill so the callback
  // can distinguish our inactivity kill from an external SIGTERM.
  let lastActivityTs = Date.now();
  let killedByInactivity = false;
  currentLastActivityTs = new Date();

  heartbeatState.status = 'processing';
  heartbeatState.current_slice = id;
  heartbeatState.current_slice_title = title || null;
  heartbeatState.current_slice_goal = goal || null;
  heartbeatState.pickupTime = pickupTime;
  writeHeartbeat();

  log('info', 'invoke', {
    id,
    msg: 'Invoking claude -p',
    command: config.claudeCommand,
    args: config.claudeArgs,
    cwd: worktreePath,
    inactivityTimeoutMs: effectiveInactivityMs,
  });

  // Progress tick: every 60s while Rom is running — stdout only, not bridge.log.
  const tickInterval = setInterval(() => {
    printProgressTick(Date.now() - pickupTime);
  }, 60000);

  const child = execFile(
    config.claudeCommand,
    config.claudeArgs,
    {
      cwd: worktreePath,
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

      // ── POST-INVOCATION BRANCH VERIFICATION (worktree) ──────────────────
      // With worktrees, verify the branch state inside the worktree, not
      // PROJECT_DIR (which stays on main permanently).
      try {
        const wtCwd = fs.existsSync(worktreePath) ? worktreePath : PROJECT_DIR;
        const branchCheck = verifyBranchState(id, sliceBranch, wtCwd);
        if (!branchCheck.ok) {
          log('warn', 'git_safety', {
            id,
            msg: `Post-invocation branch check: ${branchCheck.issues.length} issue(s)`,
            issues: branchCheck.issues,
            branch: sliceBranch,
            worktreePath,
          });
        }
      } catch (verifyErr) {
        log('warn', 'git_safety', { id, msg: 'Post-invocation branch verification error (non-fatal)', error: verifyErr.message });
      }
      // ────────────────────────────────────────────────────────────────────

      // ── Copy DONE file from worktree to PROJECT_DIR ─────────────────────
      // Rom writes to the worktree. The evaluation pipeline reads from
      // PROJECT_DIR/bridge/queue/. Copy so both pipelines work.
      try {
        if (fs.existsSync(worktreeDonePath) && !fs.existsSync(donePath)) {
          fs.copyFileSync(worktreeDonePath, donePath);
          log('info', 'worktree', { id, msg: 'Copied DONE file from worktree to PROJECT_DIR' });
        }
      } catch (copyErr) {
        log('warn', 'worktree', { id, msg: 'Failed to copy DONE file from worktree', error: copyErr.message });
      }
      // ────────────────────────────────────────────────────────────────────

      if (!err) {
        // Success path: check Rom wrote his DONE file.
        if (fs.existsSync(donePath)) {
          // --- Metrics validation gate (Bet 3) ---
          let doneMeta = null;
          try {
            doneMeta = parseFrontmatter(fs.readFileSync(donePath, 'utf-8'));
          } catch (_) {}

          const metricsValid = validateDoneMetrics(doneMeta);
          if (!metricsValid.ok) {
            log('warn', 'complete', {
              id,
              msg: "Rom DONE file has incomplete metrics — writing ERROR (incomplete_metrics)",
              reason: 'incomplete_metrics',
              invalid: metricsValid.invalid,
              durationMs,
            });
            writeErrorFile(errorPath, id, 'incomplete_metrics', null, stdout, '', { missingFields: metricsValid.invalid, durationMs });
            log('info', 'state', { id, from: 'IN_PROGRESS', to: 'ERROR', reason: 'incomplete_metrics' });
            registerEvent(id, 'ERROR', {
              reason: 'incomplete_metrics',
              phase: 'rom_invocation',
              command: [config.claudeCommand, ...config.claudeArgs].join(' '),
              exit_code: null,
              stderr_tail: truncStderr(stderr),
              invalid: metricsValid.invalid,
              durationMs,
            });
            appendKiraEvent({
              event: 'ERROR',
              slice_id: id,
              root_id: sliceMeta.root_commission_id || null,
              cycle: null,
              branch: sliceBranch || null,
              details: `Slice ${id} errored: incomplete_metrics`,
            });
            closeSliceBlock(false, durationMs, tokensIn, tokensOut, costUsd, 'Incomplete metrics in DONE report');
            recordSessionResult(false, tokensIn, tokensOut, costUsd);
          } else {
            // --- Rom verification gate (slice 212) ---
            const verify = verifyRomActuallyWorked(id, sliceBranch, durationMs, tokensOut);
            if (!verify.ok) {
              writeErrorFile(errorPath, id, verify.reason, null, stdout, stderr, { detail: verify.detail, durationMs });
              registerEvent(id, 'ERROR', {
                reason: verify.reason,
                phase: 'rom_verification',
                detail: verify.detail,
                durationMs,
                actualTokensOut: tokensOut,
                stderr_tail: truncStderr(stderr),
              });
              appendKiraEvent({
                event: 'ERROR',
                slice_id: id,
                root_id: sliceMeta.root_commission_id || null,
                cycle: null,
                branch: sliceBranch || null,
                details: `Slice ${id} errored: ${verify.reason}`,
              });
              log('warn', 'rom', { id, msg: 'Rom wrote DONE but verification failed — treating as error', reason: verify.reason, detail: verify.detail });
              closeSliceBlock(false, durationMs, tokensIn, tokensOut, costUsd, 'Rom verification failed: ' + verify.reason);
              recordSessionResult(false, tokensIn, tokensOut, costUsd);
              return;
            }

            // --- Write Point 1: append timesheet row (Bet 3) ---
            const sliceMeta = parseFrontmatter(sliceContent) || {};
            const expectedHours = sliceMeta.expected_human_hours && sliceMeta.expected_human_hours !== 'null'
              ? parseFloat(sliceMeta.expected_human_hours)
              : null;
            const doneTokensIn  = parseInt(doneMeta.tokens_in, 10);
            const doneTokensOut = parseInt(doneMeta.tokens_out, 10);
            const timesheetCost = computeCost(doneTokensIn, doneTokensOut);

            // timesheet write point 1 — append orchestrator row at DONE
            appendTimesheet({
              ts: new Date(pickupTime).toISOString(),
              role: 'rom',
              source: 'orchestrator',
              commission_id: String(id),
              title: (sliceMeta.title || title || '').replace(/^["']|["']$/g, ''),
              phase: null,
              human_hours: parseFloat(doneMeta.estimated_human_hours),
              human_role: null,
              actual_minutes: null,
              notes: null,
              deliverable: null,
              slice: null,
              tokens_in: doneTokensIn,
              tokens_out: doneTokensOut,
              cost_usd: timesheetCost,
              elapsed_ms: parseInt(doneMeta.elapsed_ms, 10),
              compaction_occurred: doneMeta.compaction_occurred === 'true',
              runtime: 'legacy',
              expected_human_hours: isNaN(expectedHours) ? null : expectedHours,
              result: null,
              cycle: null,
              ts_pickup: new Date(pickupTime).toISOString(),
              ts_done: new Date().toISOString(),
              ts_result: null,
            });

            log('info', 'complete', { id, msg: "Rom finished — DONE file present", durationMs, tokensIn, tokensOut });
            log('info', 'state', { id, from: 'IN_PROGRESS', to: 'DONE' });
            registerEvent(id, 'DONE', { durationMs, tokensIn, tokensOut, costUsd });
            closeSliceBlock(true, durationMs, tokensIn, tokensOut, costUsd, null);
            recordSessionResult(true, tokensIn, tokensOut, costUsd);
          }
        } else {
          // Rom exited 0 but wrote no DONE file — classify and rescue/wipe.
          const noReportClass = classifyNoReportExit(id, worktreePath, sliceBranch);
          const classifiedReason = noReportClass.reason;
          log('warn', 'complete', {
            id,
            msg: `Rom exited cleanly but wrote no DONE file — classified as ${classifiedReason}`,
            reason: classifiedReason,
            hasCommits: noReportClass.hasCommits,
            hasDiff: noReportClass.hasDiff,
            durationMs,
          });

          // Rescue or wipe based on classification
          let rescuePath = null;
          if (classifiedReason !== 'rom_self_terminated_empty') {
            rescuePath = rescueWorktree(id, sliceBranch, noReportClass, stdout, stderr);
          } else {
            try { cleanupWorktree(id, sliceBranch); } catch (_) {}
          }

          writeErrorFile(errorPath, id, classifiedReason, null, stdout, stderr, { durationMs, rescue_path: rescuePath });
          log('info', 'state', { id, from: 'IN_PROGRESS', to: 'ERROR', reason: classifiedReason });
          registerEvent(id, 'ERROR', {
            reason: classifiedReason,
            phase: 'rom_invocation',
            command: [config.claudeCommand, ...config.claudeArgs].join(' '),
            exit_code: null,
            stderr_tail: truncStderr(stderr),
            durationMs,
            rescue_path: rescuePath,
          });
          appendKiraEvent({
            event: 'ERROR',
            slice_id: id,
            root_id: sliceMeta.root_commission_id || null,
            cycle: null,
            branch: sliceBranch || null,
            details: `Slice ${id} errored: ${classifiedReason}${rescuePath ? ` (rescued to ${rescuePath})` : ''}`,
          });
          // timesheet write point 2 — update orchestrator row at terminal state
          updateTimesheet(id, { result: 'ERROR', cycle: null, ts_result: new Date().toISOString() });
          closeSliceBlock(false, durationMs, tokensIn, tokensOut, costUsd, 'No report written');
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
          extra = { lastActivitySecondsAgo, inactivityLimitMinutes, durationMs };
          log('error', 'inactivity_timeout', {
            id,
            msg: 'Slice killed due to inactivity',
            reason,
            lastActivitySecondsAgo,
            inactivityLimitMinutes,
            durationMs,
          });
        } else {
          reason = (err.killed && err.signal === 'SIGTERM') ? 'timeout' : 'crash';
          reasonDisplay = reason === 'timeout' ? 'Timed out' : 'Process failed';
          extra = { durationMs };
          log('error', reason === 'timeout' ? 'timeout' : 'error', {
            id,
            msg: reason === 'timeout' ? 'Slice timed out' : 'claude -p failed',
            reason,
            exitCode: err.code,
            signal: err.signal || null,
            durationMs,
          });
        }

        // ── Rate limit recovery ───────────────────────────────────────────────
        // Claude API returns is_error:true with "hit your limit" text when the
        // account's rate limit is exceeded.  This is NOT a bug in the slice —
        // requeue it and pause dispatch until the limit resets.
        const isRateLimit = reason === 'crash' && stdout &&
          (stdout.includes('hit your limit') || stdout.includes('your limit'));

        if (isRateLimit) {
          // Calculate how long to wait before retrying.
          const parsedWaitMs = parseRateLimitResetMs(stdout);
          const waitMs       = parsedWaitMs != null ? parsedWaitMs + 60000 : 3600000; // +1 min buffer; default 1h
          rateLimitUntil     = Date.now() + waitMs;
          const waitMin      = Math.round(waitMs / 60000);
          const resetAt      = new Date(rateLimitUntil).toLocaleTimeString();

          try {
            // Requeue: write back as QUEUED (preserving all frontmatter).
            const ipContent = fs.readFileSync(inProgressPath, 'utf8');
            const updated   = updateFrontmatter(ipContent, { status: 'QUEUED' });
            fs.writeFileSync(path.join(QUEUE_DIR, `${id}-QUEUED.md`), updated, 'utf8');
            try { fs.renameSync(inProgressPath, path.join(TRASH_DIR, path.basename(inProgressPath) + '.ratelimit')); } catch (_) {}
            log('warn', 'rate_limit', {
              id,
              msg: `Claude API rate limit — requeueing slice; dispatch paused ${waitMin}min (until ~${resetAt})`,
              waitMs,
              durationMs,
            });
            registerEvent(id, 'RATE_LIMITED', {
              waitMs,
              resetAt,
              durationMs,
              title,
            });
            print(`  ${C.yellow}⏸${C.reset}  Rate limit hit — slice ${id} requeued. Dispatch paused ${waitMin} min (≈${resetAt})`);
            processing = false;
            heartbeatState.status = 'idle';
            heartbeatState.current_slice = null;
            heartbeatState.current_slice_title = null;
            heartbeatState.current_slice_goal = null;
            heartbeatState.pickupTime = null;
            try { fs.renameSync(NOG_ACTIVE_FILE, path.join(TRASH_DIR, 'nog-active.json.ratelimit')); } catch (_) {}
            return; // Skip ERROR file — slice will be retried after the pause
          } catch (rlErr) {
            log('error', 'rate_limit', { id, msg: 'Rate limit requeue failed — falling through to ERROR', error: rlErr.message });
            rateLimitUntil = null;
          }
        }

        // ── API error recovery ────────────────────────────────────────────────
        // If the crash was caused by a transient Anthropic API error (HTTP 5xx),
        // move the slice back to QUEUED for automatic retry instead of losing it.
        // A retry-count embedded in the frontmatter limits retries to MAX_API_RETRIES.
        const MAX_API_RETRIES = 3;
        const isApiError = reason === 'crash' && stdout &&
          (stdout.includes('"api_error"') || /API Error: 5\d\d/.test(stdout));

        if (isApiError) {
          // Parse current retry count from IN_PROGRESS frontmatter
          let retryCount = 0;
          try {
            const ipContent = fs.readFileSync(inProgressPath, 'utf8');
            const ipFm = parseFrontmatter(ipContent);
            retryCount = parseInt(ipFm._api_retry_count || '0', 10) || 0;
          } catch (_) {}

          if (retryCount < MAX_API_RETRIES) {
            // Bump retry count in frontmatter, rename back to QUEUED
            try {
              const ipContent = fs.readFileSync(inProgressPath, 'utf8');
              const updated  = updateFrontmatter(ipContent, {
                status: 'QUEUED',
                _api_retry_count: String(retryCount + 1),
              });
              fs.writeFileSync(path.join(QUEUE_DIR, `${id}-QUEUED.md`), updated, 'utf8');
              // inProgressPath will be cleaned up below (renamed → SLICE via normal flow
              // won't happen since we're returning early; move to trash explicitly)
              try { fs.renameSync(inProgressPath, path.join(TRASH_DIR, path.basename(inProgressPath) + '.api-retry')); } catch (_) {}
              log('warn', 'api_retry', {
                id,
                msg: `Anthropic API error — requeueing for retry (attempt ${retryCount + 1}/${MAX_API_RETRIES})`,
                durationMs,
              });
              // Write to register so the dashboard can surface a toast
              registerEvent(id, 'API_RETRY', {
                retryCount: retryCount + 1,
                maxRetries: MAX_API_RETRIES,
                durationMs,
                title,
              });
              processing = false;
              heartbeatState.status = 'idle';
              heartbeatState.current_slice = null;
              heartbeatState.current_slice_title = null;
              heartbeatState.current_slice_goal = null;
              heartbeatState.pickupTime = null;
              try { fs.renameSync(NOG_ACTIVE_FILE, path.join(TRASH_DIR, 'nog-active.json.api-retry')); } catch (_) {}
              return; // Skip ERROR file — slice will be retried
            } catch (retryErr) {
              log('error', 'api_retry', { id, msg: 'Retry requeue failed, falling through to ERROR', error: retryErr.message });
            }
          } else {
            log('warn', 'api_retry', { id, msg: `API error retry limit (${MAX_API_RETRIES}) reached — writing ERROR`, durationMs });
          }
        }
        // ─────────────────────────────────────────────────────────────────────

        // ── Manual abort guard ─────���────────────────────────────────────────
        // When handleAbort() SIGKILLs the child, the promise rejects and lands
        // here. But handleAbort already emitted ROM_ABORTED and cleaned up.
        // Suppress the ghost ERROR so it doesn't pollute metrics or create a
        // false-positive ERROR.md file.
        const latestForAbortGuard = getLatestLifecycleEvent(id);
        if (latestForAbortGuard && latestForAbortGuard.event === 'ROM_ABORTED' && latestForAbortGuard.reason === 'manual') {
          log('info', 'control', { id, msg: 'Suppressing ghost ERROR — slice was manually aborted', reason });
          closeSliceBlock(false, durationMs, tokensIn, tokensOut, costUsd, 'Manually aborted');
          recordSessionResult(false, tokensIn, tokensOut, costUsd);
        } else {
        // ──────���──────────────────────────────────────────────────────────────
        writeErrorFile(errorPath, id, reason, err, stdout, stderr, extra);
        log('info', 'state', { id, from: 'IN_PROGRESS', to: 'ERROR', reason });
        registerEvent(id, 'ERROR', {
          reason,
          phase: 'rom_invocation',
          command: [config.claudeCommand, ...config.claudeArgs].join(' '),
          exit_code: err.code != null ? err.code : null,
          stderr_tail: truncStderr(stderr),
          durationMs,
        });
        appendKiraEvent({
          event: 'ERROR',
          slice_id: id,
          root_id: sliceMeta.root_commission_id || null,
          cycle: null,
          branch: sliceBranch || null,
          details: `Slice ${id} errored: ${reason}`,
        });
        // timesheet write point 2 — update orchestrator row at terminal state
        updateTimesheet(id, { result: 'ERROR', cycle: null, ts_result: new Date().toISOString() });
        closeSliceBlock(false, durationMs, tokensIn, tokensOut, costUsd, reasonDisplay);
        recordSessionResult(false, tokensIn, tokensOut, costUsd);
        }
      }

      printSessionSummary();

      // Park the original slice so Nog's evaluation task can find the
      // success criteria.  Rename IN_PROGRESS → PARKED (intermediate hold).
      // The PARKED suffix is inert — the poll loop only looks for QUEUED/PENDING files.
      const parkedPath = path.join(QUEUE_DIR, `${id}-PARKED.md`);
      if (fs.existsSync(inProgressPath)) {
        try {
          fs.renameSync(inProgressPath, parkedPath);
          log('info', 'state', { id, msg: 'Parked slice', from: 'IN_PROGRESS', to: 'PARKED' });
        } catch (archiveErr) {
          // Fallback: if rename fails, try to delete so the queue doesn't jam.
          log('warn', 'error', { id, msg: 'Failed to park IN_PROGRESS file, trashing instead', error: archiveErr.message });
          try { fs.renameSync(inProgressPath, path.join(TRASH_DIR, path.basename(inProgressPath) + '.park-fail')); } catch (_) {}
        }
      }

      // Remove from active children map.
      activeChildren.delete(String(id));

      // Reset processing state.
      processing = false;
      heartbeatState.status = 'idle';
      heartbeatState.current_slice = null;
      heartbeatState.current_slice_title = null;
      heartbeatState.current_slice_goal = null;
      heartbeatState.pickupTime = null;
      heartbeatState.processed_total += 1;
      sessionHasProcessed = true;
      writeHeartbeat();
    }
  );

  // Track child process for pause/resume/abort.
  activeChildren.set(String(id), { child, worktreePath });

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

/**
 * latestRestagedTs(id, regFile)
 *
 * Returns the latest ts string of any RESTAGED event for this slice ID,
 * or null if none exists. Used to scope per-attempt register reads.
 * Accepts an optional regFile path for testing.
 */
function latestRestagedTs(id, regFile) {
  const file = regFile || REGISTER_FILE;
  try {
    const lines = fs.readFileSync(file, 'utf-8').trim().split('\n').filter(Boolean);
    let latest = null;
    for (const line of lines) {
      try {
        const raw = JSON.parse(line);
        const sid = String(raw.slice_id || raw.id || '');
        if (sid === String(id) && raw.event === 'RESTAGED') {
          if (!latest || raw.ts > latest) latest = raw.ts;
        }
      } catch (_) {}
    }
    return latest;
  } catch (_) { return null; }
}

/**
 * latestAttemptStartTs(id, regFile)
 *
 * Returns the ISO timestamp of the most recent event marking the start of the
 * current attempt. Resolution order: latest RESTAGED → latest COMMISSIONED → null.
 * Accepts an optional regFile path for testing.
 */
function latestAttemptStartTs(id, regFile) {
  const file = regFile || REGISTER_FILE;
  try {
    const lines = fs.readFileSync(file, 'utf-8').trim().split('\n').filter(Boolean);
    let latestRestaged = null;
    let latestCommissioned = null;
    for (const line of lines) {
      try {
        const raw = JSON.parse(line);
        const sid = String(raw.slice_id || raw.id || '');
        if (sid !== String(id)) continue;
        if (raw.event === 'RESTAGED') {
          if (!latestRestaged || raw.ts > latestRestaged) latestRestaged = raw.ts;
        } else if (raw.event === 'COMMISSIONED') {
          if (!latestCommissioned || raw.ts > latestCommissioned) latestCommissioned = raw.ts;
        }
      } catch (_) {}
    }
    return latestRestaged || latestCommissioned || null;
  } catch (_) { return null; }
}

/**
 * hasReviewEvent(id, regFile)
 *
 * Returns true if the current attempt has reached a terminal review state:
 * MERGED, STUCK, or NOG_DECISION with verdict ACCEPTED. REJECTED and ESCALATE
 * verdicts are intermediate — they do not block re-dispatch. The attempt
 * boundary is latestAttemptStartTs (RESTAGED → COMMISSIONED → null).
 * Accepts an optional regFile path for testing.
 */
function hasReviewEvent(id, regFile) {
  const file = regFile || REGISTER_FILE;
  try {
    const cutoff = latestAttemptStartTs(id, file);
    if (cutoff === null) return false;
    const lines = fs.readFileSync(file, 'utf-8').trim().split('\n').filter(Boolean);
    resetDedupeState();
    for (const line of lines) {
      try {
        const raw = JSON.parse(line);
        const entry = translateEvent(raw);
        if (!entry || entry.id !== String(id)) continue;
        if (entry.ts <= cutoff) continue;
        if (entry.event === 'MERGED') return true;
        if (entry.event === 'STUCK') return true;
        if (entry.event === 'NOG_DECISION' && entry.verdict === 'ACCEPTED') return true;
      } catch (_) {}
    }
  } catch (_) {}
  return false;
}

/**
 * hasMergedEvent(id, regFile)
 *
 * Returns true if register.jsonl contains a MERGED event for this brief ID after
 * the latest RESTAGED marker — meaning the current attempt's branch was merged.
 * Accepts an optional regFile path for testing.
 */
function hasMergedEvent(id, regFile) {
  const file = regFile || REGISTER_FILE;
  try {
    const cutoff = latestRestagedTs(id, file);
    const lines = fs.readFileSync(file, 'utf-8').trim().split('\n').filter(Boolean);
    resetDedupeState();
    for (const line of lines) {
      try {
        const raw = JSON.parse(line);
        const entry = translateEvent(raw);
        if (entry && entry.id === String(id) && entry.event === 'MERGED') {
          if (!cutoff || entry.ts > cutoff) return true;
        }
      } catch (_) {}
    }
  } catch (_) {}
  return false;
}

/**
 * mergeBranch(id, branchName, title)
 *
 * Worktree-based FUSE-safe merge:
 *   1. In the worktree: merge main into slice branch (runs on local FS, not FUSE)
 *   2. In PROJECT_DIR: update-ref to fast-forward main to the merge result
 *   3. Sync changed files from worktree to PROJECT_DIR via fs.copyFileSync
 *   4. Update index with git read-tree
 *   5. Post-merge verification + push
 *
 * Returns { success, sha, error } where sha is the merge commit hash on success.
 */

/**
 * assertMergeIntegrity(id, expectedSha)
 *
 * Post-merge local integrity guard (W2). Asserts that expectedSha is both
 * an ancestor of main and the current tip of main.
 *
 * Returns { ok: true } on success.
 * Returns { ok: false, actualSha, reason } on failure where reason is one of:
 *   'not_ancestor' | 'tip_mismatch' | 'check_failed'
 */
function assertMergeIntegrity(id, expectedSha) {
  try {
    // Check 1: expectedSha must be reachable from main
    try {
      gitFinalizer.runGit(`git merge-base --is-ancestor ${expectedSha} main`, { slice_id: id, op: 'mergeIntegrity_ancestry', execOpts: { stdio: 'pipe' } });
    } catch (_) {
      const actualSha = gitFinalizer.runGit('git rev-parse main', { slice_id: id, op: 'mergeIntegrity_tipAfterAncestryFail', encoding: 'utf-8' }).trim();
      return { ok: false, actualSha, reason: 'not_ancestor' };
    }

    // Check 2: main tip must equal expectedSha
    const actualSha = gitFinalizer.runGit('git rev-parse main', { slice_id: id, op: 'mergeIntegrity_tip', encoding: 'utf-8' }).trim();
    if (actualSha !== expectedSha) {
      return { ok: false, actualSha, reason: 'tip_mismatch' };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, actualSha: null, reason: 'check_failed' };
  }
}

function mergeBranch(id, branchName, title) {
  // ── Branch name sanitization (defence against shell injection) ────────
  try {
    branchName = sanitizeBranchName(branchName);
  } catch (err) {
    log('error', 'merge', { id, msg: 'Branch name rejected by sanitizer', error: err.message });
    return { success: false, sha: null, error: `invalid_branch_name: ${err.message}` };
  }

  const commitMsg = `merge: ${branchName} — ${title || `slice ${id}`} (slice ${id})`;

  // Ensure worktree exists for the merge
  let wtPath = getWorktreePath(id);
  if (!fs.existsSync(wtPath)) {
    try {
      wtPath = createWorktree(id, branchName);
    } catch (wtErr) {
      log('error', 'merge', { id, msg: 'Could not create worktree for merge', error: wtErr.message });
      return { success: false, sha: null, error: `worktree_creation_failed: ${wtErr.message}` };
    }
  }

  // ── Layer 2 enforcement: unlock source paths before merge, re-lock after ──
  const unlockScript = path.join(PROJECT_DIR, 'scripts', 'unlock-main.sh');
  const lockScript   = path.join(PROJECT_DIR, 'scripts', 'lock-main.sh');
  try { execSync(`bash "${unlockScript}"`, { cwd: PROJECT_DIR, stdio: 'pipe' }); } catch (_) {}

  // Set DS9_WATCHER_MERGE so the pre-commit hook (Layer 1) allows this path.
  process.env.DS9_WATCHER_MERGE = '1';

  try {
    // ── Step 1: Merge main into slice branch in the worktree ───────────
    // This runs on local FS (/tmp), not FUSE. Resolves any main changes
    // since the branch was created.
    const oldMain = gitFinalizer.runGit('git rev-parse main', { slice_id: id, op: 'mergeBranch_oldMain', encoding: 'utf-8' }).trim();
    gitFinalizer.runGit(`git merge main -m "${commitMsg.replace(/"/g, '\\"')}"`, { slice_id: id, op: 'mergeBranch_merge', cwd: wtPath, execOpts: { stdio: 'pipe' } });

    // ── Step 2: Fast-forward main to the merge result ──────────────────
    const newSha = gitFinalizer.runGit(`git rev-parse ${branchName}`, { slice_id: id, op: 'mergeBranch_newSha', encoding: 'utf-8' }).trim();
    gitFinalizer.runGit(`git update-ref refs/heads/main ${newSha}`, { slice_id: id, op: 'mergeBranch_updateRef', execOpts: { stdio: 'pipe' } });

    // ── Step 2.5: Post-merge integrity assertion (W2) ─────────────────
    const integrity = assertMergeIntegrity(id, newSha);
    if (!integrity.ok) {
      registerEvent(id, 'MERGE_INTEGRITY_VIOLATION', {
        slice_id: String(id),
        expected_sha: newSha,
        actual_sha: integrity.actualSha,
        reason: integrity.reason,
      });
      log('warn', 'merge', { id, msg: 'Post-merge integrity assertion failed', expected_sha: newSha, actual_sha: integrity.actualSha, reason: integrity.reason });
      return { success: false, sha: null, error: 'merge_integrity_violation' };
    }

    // ── Step 3: Sync changed files from worktree to PROJECT_DIR ────────
    // FUSE handles writes fine (writeFileSync truncates in-place).
    const diffRaw = gitFinalizer.runGit(`git diff --name-only ${oldMain} main`, { slice_id: id, op: 'mergeBranch_diffFiles', encoding: 'utf-8' }).trim();
    if (diffRaw) {
      for (const file of diffRaw.split('\n').filter(Boolean)) {
        const srcPath = path.join(wtPath, file);
        const dstPath = path.join(PROJECT_DIR, file);
        try {
          if (fs.existsSync(srcPath)) {
            fs.mkdirSync(path.dirname(dstPath), { recursive: true });
            fs.copyFileSync(srcPath, dstPath);
          } else {
            // File deleted on branch — move to trash (FUSE-safe)
            if (fs.existsSync(dstPath)) {
              fs.renameSync(dstPath, path.join(TRASH_DIR, path.basename(file) + '.merge-cleanup'));
            }
          }
        } catch (syncErr) {
          log('warn', 'merge', { id, msg: `File sync failed for ${file}`, error: syncErr.message });
        }
      }
    }

    // ── Step 4: Update index to match new main ─────────────────────────
    gitFinalizer.runGit('git read-tree main', { slice_id: id, op: 'mergeBranch_readTree', execOpts: { stdio: 'pipe' } });

    // ── Post-merge verification ─────────────────────────────────────────
    // Safety net: ensure disk matches committed state.
    verifyWorkingTreeMatchesMain(id, 'merge');

    try {
      gitFinalizer.runGit('git push origin main', { slice_id: id, op: 'mergeBranch_push', execOpts: { stdio: 'pipe' } });
    } catch (pushErr) {
      // Push failure is non-fatal — the merge succeeded locally.
      log('warn', 'merge', { id, msg: 'git push origin main failed (merge succeeded locally)', error: pushErr.message });
    }
    return { success: true, sha: newSha, error: null };
  } catch (err) {
    // Abort any in-progress merge in the worktree to leave git in a clean state.
    try { gitFinalizer.runGit('git merge --abort', { slice_id: id, op: 'mergeBranch_abort', cwd: wtPath, execOpts: { stdio: 'pipe' } }); } catch (_) {}
    return { success: false, sha: null, error: err.stderr ? err.stderr.toString().trim() : err.message };
  } finally {
    // Always re-lock and clear the env var, even on failure.
    delete process.env.DS9_WATCHER_MERGE;
    try { execSync(`bash "${lockScript}"`, { cwd: PROJECT_DIR, stdio: 'pipe' }); } catch (_) {}
  }
}

/**
 * handleAccepted(id, reason, cycle, branchName, evaluatingPath, durationMs)
 *
 * ACCEPTED verdict: register event, rename EVALUATING → ACCEPTED, merge branch to main directly.
 */
function handleAccepted(id, reason, cycle, branchName, evaluatingPath, durationMs) {
  // Read title from parked slice file for the merge commit message.
  const parkedPath = path.join(QUEUE_DIR, `${id}-PARKED.md`);
  const legacyParkedPath = path.join(QUEUE_DIR, `${id}-ARCHIVED.md`);
  const resolvedParkedPath = fs.existsSync(parkedPath) ? parkedPath : legacyParkedPath;
  let title = null;
  try {
    const commMeta = parseFrontmatter(fs.readFileSync(resolvedParkedPath, 'utf-8'));
    if (commMeta) title = commMeta.title || null;
  } catch (_) {}

  // Canonical: NOG_DECISION (verdict) → rename → merge → MERGED
  registerEvent(id, 'NOG_DECISION', { verdict: 'ACCEPTED', reason, cycle, round: cycle });
  log('info', 'evaluator', { id, verdict: 'ACCEPTED', cycle, durationMs });

  // timesheet write point 2 — update orchestrator row at terminal state
  updateTimesheet(id, { result: 'ACCEPTED', cycle, ts_result: new Date().toISOString() });

  const acceptedPath = path.join(QUEUE_DIR, `${id}-ACCEPTED.md`);
  try {
    fs.renameSync(evaluatingPath, acceptedPath);
    log('info', 'state', { id, from: 'EVALUATING', to: 'ACCEPTED' });
  } catch (err) {
    log('warn', 'evaluator', { id, msg: 'Failed to rename EVALUATING to ACCEPTED', error: err.message });
  }

  // Merge branch to main directly — no separate merge slice.
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
    registerEvent(id, 'MERGED', { branch: branchName, sha: result.sha, slice_id: id });
    log('info', 'merge', { id, msg: `Merged ${branchName} to main`, branch: branchName, sha: result.sha });
    print(`${B.vert}    ${C.green}${SYM.check}${C.reset} ACCEPTED${SYM.sep}Merged ${branchName}${SYM.arrow}main (${shortSha})`);
    // Clean up the worktree after successful merge
    try { cleanupWorktree(id, branchName); } catch (_) {}
  } else {
    registerEvent(id, 'MERGE_FAILED', { branch: branchName, reason: result.error, slice_id: id });
    log('error', 'merge', { id, msg: `Merge failed for ${branchName}`, branch: branchName, reason: result.error });
    print(`${B.vert}    ${C.green}${SYM.check}${C.reset} ACCEPTED${SYM.sep}${C.red}${SYM.cross}${C.reset} Merge failed: ${result.error}`);
    printMergeFailedAlert(id, title, branchName, result.error);
  }

  print(`${B.bl}${B.sng.repeat(W - 1)}`);
  print('');
}

// ---------------------------------------------------------------------------
// Nog code review invocation
// ---------------------------------------------------------------------------

/**
 * countNogRounds(sliceContent)
 *
 * Counts existing `## Nog Review — Round N` headers in the slice file
 * to determine the current round number.
 */
function countNogRounds(sliceContent) {
  const matches = sliceContent.match(/^## Nog Review — Round \d+/gm);
  return matches ? matches.length : 0;
}

/**
 * invokeNog(id)
 *
 * Reads the PARKED slice and DONE report for a given slice ID,
 * determines the current Nog review round, builds the Nog prompt,
 * invokes Nog headless via `claude -p`, and handles the verdict.
 *
 * PASS → proceed to existing evaluator flow (ACCEPTED path).
 * RETURN → rewrite slice in-place and re-queue for O'Brien.
 * Round 6 → escalate to Kira.
 */
function invokeNog(id) {
  const parkedPath = path.join(QUEUE_DIR, `${id}-PARKED.md`);
  const legacyParkedPath = path.join(QUEUE_DIR, `${id}-ARCHIVED.md`);
  const donePath = path.join(QUEUE_DIR, `${id}-EVALUATING.md`); // renamed from DONE by poll loop

  // Read PARKED file (original slice + any prior Nog reviews). Fall back to legacy ARCHIVED.
  const resolvedParkedPath = fs.existsSync(parkedPath) ? parkedPath : legacyParkedPath;
  let sliceContent;
  try {
    sliceContent = fs.readFileSync(resolvedParkedPath, 'utf-8');
  } catch (err) {
    log('warn', 'nog', { id, msg: 'PARKED file not found — skipping Nog review', error: err.message });
    try { fs.renameSync(donePath, path.join(QUEUE_DIR, `${id}-DONE.md`)); } catch (_) {}
    processing = false;
    heartbeatState.status = 'idle';
    heartbeatState.current_slice = null;
    heartbeatState.current_slice_goal = null;
    heartbeatState.pickupTime = null;
    writeHeartbeat();
    return;
  }

  // Read DONE report (EVALUATING is the renamed DONE).
  let doneReportContents;
  try {
    doneReportContents = fs.readFileSync(donePath, 'utf-8');
  } catch (err) {
    log('warn', 'nog', { id, msg: 'EVALUATING file not found — skipping Nog review', error: err.message });
    processing = false;
    heartbeatState.status = 'idle';
    heartbeatState.current_slice = null;
    heartbeatState.current_slice_goal = null;
    heartbeatState.pickupTime = null;
    writeHeartbeat();
    return;
  }

  // Extract branch name from DONE report.
  const doneMeta = parseFrontmatter(doneReportContents) || {};
  const branchName = doneMeta.branch || null;
  const sliceMeta = parseFrontmatter(sliceContent) || {};
  const rootId = sliceMeta.root_commission_id || id;

  // Determine round number.
  const existingRounds = countNogRounds(sliceContent);
  const round = existingRounds + 1;

  // Round 6 escalation: do not invoke Nog again.
  if (round > 5) {
    log('warn', 'nog', { id, msg: `Round ${round} — escalating to Kira`, round });

    // Write escalation file.
    const escalationContent = [
      '---',
      `id: "${id}"`,
      `title: "NOG ESCALATION — slice ${id}"`,
      'from: nog',
      'to: kira',
      `created: "${new Date().toISOString()}"`,
      `round: ${round}`,
      `branch: "${branchName || ''}"`,
      '---',
      '',
      '## Nog Escalation — Round 6',
      '',
      `Slice ${id} has not passed Nog review after 5 rounds.`,
      'Full slice history (including all Nog review rounds) follows.',
      '',
      '## Slice file contents',
      '',
      sliceContent,
      '',
      "## O'Brien's latest DONE report",
      '',
      doneReportContents,
    ].join('\n');

    try {
      fs.writeFileSync(path.join(ESCALATIONS_DIR, `${id}-NOG-ESCALATION.md`), escalationContent);
      log('info', 'nog', { id, msg: 'Wrote NOG-ESCALATION file' });
    } catch (err) {
      log('error', 'nog', { id, msg: 'Failed to write NOG-ESCALATION file', error: err.message });
    }

    appendKiraEvent({
      event: 'NOG_ESCALATION',
      slice_id: id,
      root_id: rootId !== id ? rootId : null,
      cycle: round,
      branch: branchName || null,
      details: `Slice ${id} failed Nog review after 5 rounds — escalating to Kira`,
    });

    // Append round entry for the exhausted round to PARKED file.
    const romTelemetryExhausted = extractRomTelemetry(doneReportContents);
    appendRoundEntry(resolvedParkedPath, {
      round: 5,
      commissioned_at: romTelemetryExhausted.commissioned_at,
      done_at: romTelemetryExhausted.done_at,
      durationMs: romTelemetryExhausted.durationMs,
      tokensIn: romTelemetryExhausted.tokensIn,
      tokensOut: romTelemetryExhausted.tokensOut,
      costUsd: romTelemetryExhausted.costUsd,
      nog_verdict: 'MAX_ROUNDS_EXHAUSTED',
      nog_reason: 'Rom exhausted 5 rounds without Nog sign-off',
    });

    registerEvent(id, 'NOG_ESCALATION', { round, branch: branchName });

    // Emit MAX_ROUNDS_EXHAUSTED terminal event for UI1 history rendering.
    registerEvent(id, 'MAX_ROUNDS_EXHAUSTED', {
      round: 5,
      reason: 'Rom exhausted 5 rounds without Nog sign-off',
    });

    // Rename to STUCK.
    const stuckPath = path.join(QUEUE_DIR, `${id}-STUCK.md`);
    try {
      fs.renameSync(donePath, stuckPath);
      log('info', 'state', { id, from: 'EVALUATING', to: 'STUCK' });
    } catch (err) {
      log('warn', 'nog', { id, msg: 'Failed to rename to STUCK', error: err.message });
    }

    // Clean up worktree for the exhausted slice.
    try { cleanupWorktree(id, branchName); } catch (_) {}

    updateTimesheet(id, { result: 'STUCK', cycle: round, ts_result: new Date().toISOString() });

    print(`${B.vert}    ${C.red}${SYM.cross}${C.reset} MAX_ROUNDS_EXHAUSTED${SYM.sep}Slice ${id} exhausted 5 Nog rounds — escalated to Kira`);
    print(`${B.bl}${B.sng.repeat(W - 1)}`);
    print('');

    processing = false;
    heartbeatState.status = 'idle';
    heartbeatState.current_slice = null;
    heartbeatState.current_slice_goal = null;
    heartbeatState.pickupTime = null;
    heartbeatState.processed_total += 1;
    writeHeartbeat();
    return;
  }

  // Build git diff.
  let gitDiff = '(no diff available)';
  if (branchName) {
    try {
      gitDiff = gitFinalizer.runGit(`git diff main...${branchName}`, { slice_id: id, op: 'nog_gitDiff', encoding: 'utf-8', execOpts: { maxBuffer: 5 * 1024 * 1024 } });
    } catch (err) {
      log('warn', 'nog', { id, msg: 'Failed to get git diff for Nog', error: err.message });
    }
  }

  // Resolve worktree path for Nog's cwd.
  let nogWorktreePath = getWorktreePath(id);
  if (!fs.existsSync(nogWorktreePath) && branchName) {
    try {
      nogWorktreePath = createWorktree(id, branchName);
    } catch (wtErr) {
      log('warn', 'nog', { id, msg: 'Could not create worktree for Nog — falling back to PROJECT_DIR', error: wtErr.message });
      nogWorktreePath = PROJECT_DIR;
    }
  } else if (!fs.existsSync(nogWorktreePath)) {
    nogWorktreePath = PROJECT_DIR;
  }

  // Build scope diff (same as evaluator used to do — now part of the single Nog pass).
  const scopeDiff = branchName ? buildScopeDiff(id, branchName, sliceContent) : '## SCOPE REVIEW — branch name unknown, scope diff unavailable\n';

  // Build prompt.
  const prompt = buildNogPrompt({
    id,
    round,
    sliceFileContents: sliceContent,
    doneReportContents,
    gitDiff,
    scopeDiff,
    slicePath: resolvedParkedPath,
  });

  log('info', 'nog', { id, round, branchName, msg: 'Invoking Nog code review' });
  print(`${B.tl}${B.sng.repeat(W - 1)}`);
  print(`${B.vert}  ${SYM.right} Nog Code Review${SYM.sep}Slice ${id} — Round ${round} of 5`);
  print(`${B.vert}    Reviewing — fresh claude -p session, slice + DONE report + diff injected`);
  print(`${B.vert}`);

  const pickupTime = Date.now();

  // Write nog-active.json for dashboard.
  try {
    fs.writeFileSync(NOG_ACTIVE_FILE, JSON.stringify({
      sliceId: String(id),
      title: sliceMeta.title || null,
      round,
      invokedAt: new Date().toISOString(),
      phase: 'code_review',
    }), 'utf8');
  } catch (_) {}

  // Progress tick every 60s.
  const tickInterval = setInterval(() => {
    printProgressTick(Date.now() - pickupTime);
  }, 60000);

  // Log file for Nog's output.
  const nogLogPath = path.join(LOGS_DIR, `nog-${id}-round${round}.log`);

  const child = execFile(
    config.claudeCommand,
    config.claudeArgs,
    {
      cwd: nogWorktreePath,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    },
    (err, stdout, stderr) => {
      clearInterval(tickInterval);
      try { fs.renameSync(NOG_ACTIVE_FILE, path.join(TRASH_DIR, 'nog-active.json.done')); } catch (_) {}
      const durationMs = Date.now() - pickupTime;

      // Write Nog's output to log file.
      try {
        fs.writeFileSync(nogLogPath, (stdout || '') + '\n--- stderr ---\n' + (stderr || ''));
      } catch (logErr) {
        log('warn', 'nog', { id, msg: 'Failed to write Nog log', error: logErr.message });
      }

      // Read Nog's verdict file.
      const nogVerdictPath = path.join(QUEUE_DIR, `${id}-NOG.md`);
      // Also check the worktree queue dir.
      const worktreeNogPath = path.join(nogWorktreePath, 'bridge', 'queue', `${id}-NOG.md`);

      // Copy verdict from worktree if needed.
      try {
        if (fs.existsSync(worktreeNogPath) && !fs.existsSync(nogVerdictPath)) {
          fs.copyFileSync(worktreeNogPath, nogVerdictPath);
        }
      } catch (_) {}

      let verdict = null;
      let summary = '';

      if (!err) {
        try {
          const nogContent = fs.readFileSync(nogVerdictPath, 'utf-8');
          const nogMeta = parseFrontmatter(nogContent);
          if (nogMeta) {
            verdict = nogMeta.verdict ? translateVerdict(nogMeta.verdict.toUpperCase()) : null;
            summary = nogMeta.summary || '';
          }
        } catch (readErr) {
          log('warn', 'nog', { id, msg: 'Failed to read NOG.md verdict', error: readErr.message });
        }
      } else {
        log('error', 'nog', { id, msg: 'claude -p Nog review failed', error: err.message, durationMs });
      }

      // Copy updated slice file from worktree if Nog appended to it.
      const worktreeParkedPath = path.join(nogWorktreePath, 'bridge', 'queue', `${id}-PARKED.md`);
      const worktreeLegacyPath = path.join(nogWorktreePath, 'bridge', 'queue', `${id}-ARCHIVED.md`);
      const worktreeResolved = fs.existsSync(worktreeParkedPath) ? worktreeParkedPath : worktreeLegacyPath;
      try {
        if (fs.existsSync(worktreeResolved)) {
          fs.copyFileSync(worktreeResolved, resolvedParkedPath);
        }
      } catch (_) {}

      // Re-read the PARKED file after worktree copy so the apendment includes
      // Nog's appended review (the closure's sliceContent is the pre-Nog version).
      let updatedSliceContent = sliceContent;
      try {
        updatedSliceContent = fs.readFileSync(resolvedParkedPath, 'utf-8');
      } catch (_) {}

      if (!verdict || !['ACCEPTED', 'REJECTED', 'ESCALATE', 'OVERSIZED'].includes(verdict)) {
        // Missing or unparseable verdict — treat as REJECTED.
        log('warn', 'nog', { id, msg: 'Nog verdict unreadable — treating as REJECTED', verdict, durationMs });

        // Append round entry to PARKED file.
        const romTelemetryUnread = extractRomTelemetry(doneReportContents);
        appendRoundEntry(resolvedParkedPath, {
          round,
          commissioned_at: romTelemetryUnread.commissioned_at,
          done_at: romTelemetryUnread.done_at,
          durationMs: romTelemetryUnread.durationMs,
          tokensIn: romTelemetryUnread.tokensIn,
          tokensOut: romTelemetryUnread.tokensOut,
          costUsd: romTelemetryUnread.costUsd,
          nog_verdict: 'NOG_DECISION_REJECTED',
          nog_reason: 'verdict_unreadable',
        });

        registerEvent(id, 'NOG_DECISION', { round, verdict: 'REJECTED', reason: 'verdict_unreadable', apendment_cycle: round });
        appendKiraEvent({
          event: 'NOG_ESCALATION',
          slice_id: id,
          root_id: rootId !== id ? rootId : null,
          cycle: round,
          branch: branchName || null,
          details: `Nog verdict unreadable for slice ${id} round ${round}`,
        });

        // Rewrite slice in-place for O'Brien with error details.
        handleNogReturn(id, rootId, round, branchName, donePath, updatedSliceContent, 'Nog verdict unreadable — manual review required', durationMs);

        print(`${B.vert}    ${C.yellow}${SYM.cross}${C.reset} Nog verdict UNREADABLE${SYM.sep}treated as RETURN (round ${round})`);
        print(`${B.bl}${B.sng.repeat(W - 1)}`);
        print('');

        processing = false;
        heartbeatState.status = 'idle';
        heartbeatState.current_slice = null;
        heartbeatState.current_slice_goal = null;
        heartbeatState.pickupTime = null;
        heartbeatState.processed_total += 1;
        writeHeartbeat();
        return;
      }

      if (verdict === 'ESCALATE' || verdict === 'OVERSIZED') {
        // Nog determined ACs cannot be satisfied as written — escalate to O'Brien.
        log('warn', 'nog', { id, verdict: 'ESCALATE', round, durationMs, summary });

        // Append round entry to PARKED file.
        const romTelemetryEsc = extractRomTelemetry(doneReportContents);
        appendRoundEntry(resolvedParkedPath, {
          round,
          commissioned_at: romTelemetryEsc.commissioned_at,
          done_at: romTelemetryEsc.done_at,
          durationMs: romTelemetryEsc.durationMs,
          tokensIn: romTelemetryEsc.tokensIn,
          tokensOut: romTelemetryEsc.tokensOut,
          costUsd: romTelemetryEsc.costUsd,
          nog_verdict: 'ESCALATE',
          nog_reason: summary || 'Nog determined acceptance criteria cannot be satisfied as written',
        });

        registerEvent(id, 'ESCALATED_TO_OBRIEN', {
          round,
          reason: summary || 'Nog determined acceptance criteria cannot be satisfied as written',
        });

        appendKiraEvent({
          event: 'ESCALATED_TO_OBRIEN',
          slice_id: id,
          root_id: rootId !== id ? rootId : null,
          cycle: round,
          branch: branchName || null,
          details: `Nog escalated slice ${id} to O'Brien: ${summary || 'ACs cannot be satisfied'}`,
        });

        // Terminal state — rename to STUCK, clean up worktree.
        const escalateStuckPath = path.join(QUEUE_DIR, `${id}-STUCK.md`);
        try {
          fs.renameSync(donePath, escalateStuckPath);
          log('info', 'state', { id, from: 'EVALUATING', to: 'STUCK', reason: 'nog_escalate' });
        } catch (renameErr) {
          log('warn', 'nog', { id, msg: 'Failed to rename to STUCK after ESCALATE', error: renameErr.message });
        }

        try { cleanupWorktree(id, branchName); } catch (_) {}

        // Clean up NOG.md verdict file.
        try { fs.renameSync(nogVerdictPath, path.join(TRASH_DIR, `${id}-NOG.md.escalate`)); } catch (_) {}

        updateTimesheet(id, { result: 'STUCK', cycle: round, ts_result: new Date().toISOString() });

        print(`${B.vert}    ${C.cyan}${SYM.cross}${C.reset} Nog ESCALATE${SYM.sep}Round ${round}${summary ? SYM.dash + summary : ''}`);
        print(`${B.vert}    Escalated to O'Brien — ACs cannot be satisfied as written`);
        print(`${B.bl}${B.sng.repeat(W - 1)}`);
        print('');

        processing = false;
        heartbeatState.status = 'idle';
        heartbeatState.current_slice = null;
        heartbeatState.current_slice_goal = null;
        heartbeatState.pickupTime = null;
        heartbeatState.processed_total += 1;
        writeHeartbeat();
        return;
      }

      if (verdict === 'ACCEPTED') {
        log('info', 'nog', { id, verdict: 'ACCEPTED', round, durationMs, summary });

        // Append round entry to PARKED file (telemetry).
        const romTelemetry = extractRomTelemetry(doneReportContents);
        appendRoundEntry(resolvedParkedPath, {
          round,
          commissioned_at: romTelemetry.commissioned_at,
          done_at: romTelemetry.done_at,
          durationMs: romTelemetry.durationMs,
          tokensIn: romTelemetry.tokensIn,
          tokensOut: romTelemetry.tokensOut,
          costUsd: romTelemetry.costUsd,
          nog_verdict: 'NOG_DECISION_ACCEPTED',
          nog_reason: summary || '',
        });

        // Clean up NOG.md verdict file.
        try { fs.renameSync(nogVerdictPath, path.join(TRASH_DIR, `${id}-NOG.md.pass`)); } catch (_) {}

        print(`${B.vert}    ${C.green}${SYM.check}${C.reset} Nog PASS${SYM.sep}Round ${round}${summary ? SYM.dash + summary : ''}`);
        print(`${B.bl}${B.sng.repeat(W - 1)}`);
        print('');

        // Single-pass: Nog ACCEPTED → merge directly (no second evaluator call).
        handleAccepted(id, summary || '', round, branchName, donePath, durationMs);

        processing = false;
        heartbeatState.status = 'idle';
        heartbeatState.current_slice = null;
        heartbeatState.current_slice_goal = null;
        heartbeatState.pickupTime = null;
        heartbeatState.processed_total += 1;
        writeHeartbeat();
        return;
      }

      // REJECTED verdict (translated from RETURN if legacy) → NOG_DECISION{verdict: REJECTED}
      log('info', 'nog', { id, verdict: 'REJECTED', round, durationMs, summary });
      registerEvent(id, 'NOG_DECISION', { round, verdict: 'REJECTED', reason: summary || 'Nog review findings — see slice file', apendment_cycle: round });

      // Append round entry to PARKED file before handleNogReturn rewrites it.
      const romTelemetryReturn = extractRomTelemetry(doneReportContents);
      appendRoundEntry(resolvedParkedPath, {
        round,
        commissioned_at: romTelemetryReturn.commissioned_at,
        done_at: romTelemetryReturn.done_at,
        durationMs: romTelemetryReturn.durationMs,
        tokensIn: romTelemetryReturn.tokensIn,
        tokensOut: romTelemetryReturn.tokensOut,
        costUsd: romTelemetryReturn.costUsd,
        nog_verdict: 'NOG_DECISION_REJECTED',
        nog_reason: summary || 'Nog review findings — see slice file',
      });

      handleNogReturn(id, rootId, round, branchName, donePath, updatedSliceContent, summary || 'Nog review findings — see slice file', durationMs);

      // Clean up NOG.md verdict file.
      try { fs.renameSync(nogVerdictPath, path.join(TRASH_DIR, `${id}-NOG.md.return`)); } catch (_) {}

      print(`${B.vert}    ${C.yellow}${SYM.cross}${C.reset} Nog RETURN${SYM.sep}Round ${round}${summary ? SYM.dash + summary : ''}`);
      print(`${B.vert}    Apendment queued for O'Brien`);
      print(`${B.bl}${B.sng.repeat(W - 1)}`);
      print('');

      processing = false;
      heartbeatState.status = 'idle';
      heartbeatState.current_slice = null;
      heartbeatState.current_slice_goal = null;
      heartbeatState.pickupTime = null;
      heartbeatState.processed_total += 1;
      writeHeartbeat();
    }
  );

  // Stream to log file as well.
  try {
    const logStream = fs.createWriteStream(nogLogPath, { flags: 'w' });
    child.stdout.on('data', (chunk) => { try { logStream.write(chunk); } catch (_) {} });
    child.stderr.on('data', (chunk) => { try { logStream.write('[stderr] ' + chunk); } catch (_) {} });
  } catch (_) {}

  child.stdin.write(prompt);
  child.stdin.end();
}

/**
 * handleNogReturn(id, rootId, round, branchName, evaluatingPath, sliceContent, summary, durationMs)
 *
 * RETURN verdict from Nog: rewrite the existing slice file in-place with an
 * "Apendment round N" section and rename back to QUEUED. The slice keeps its
 * original ID — no new slice is created.
 */
function handleNogReturn(id, rootId, round, branchName, evaluatingPath, sliceContent, summary, durationMs) {
  // Derive branch from rootId when DONE report didn't include one.
  if (!branchName) {
    branchName = `slice/${rootId}`;
    log('warn', 'nog', { id, msg: `No branch in DONE report — deriving from rootId: ${branchName}` });
  }

  // Read the PARKED file (contains original slice + Nog reviews).
  const parkedPath = path.join(QUEUE_DIR, `${id}-PARKED.md`);
  const legacyParkedPath = path.join(QUEUE_DIR, `${id}-ARCHIVED.md`);
  const resolvedParked = fs.existsSync(parkedPath) ? parkedPath : legacyParkedPath;
  let parkedContent;
  try {
    parkedContent = fs.readFileSync(resolvedParked, 'utf-8');
  } catch (_) {
    parkedContent = sliceContent;
  }

  // Update frontmatter: set status=QUEUED, round, apendment_cycle, apendment, branch.
  let updatedContent = updateFrontmatter(parkedContent, {
    status: 'QUEUED',
    round: String(round),
    apendment_cycle: String(round),
    apendment: branchName,
    branch: branchName,
  });

  // Append the apendment round section to the body.
  updatedContent += [
    '',
    `## Apendment round ${round}`,
    '',
    `This is a Nog code review return for slice ${rootId} (round ${round} of 5).`,
    '',
    '**IMPORTANT: The orchestrator handles all git branching. Do NOT run any git checkout, git branch, or git switch commands. You are already on the correct branch. Just make your changes and commit.**',
    '',
    '### Nog review summary',
    '',
    summary,
    '',
    '### Instructions',
    '',
    'Read the Nog review section appended to the slice file for detailed findings.',
    'Fix all issues identified by Nog, then write your DONE report.',
    '',
    '### Success criteria',
    '',
    '1. All Nog findings from the latest round are addressed.',
    `2. All original acceptance criteria from slice ${rootId} are met.`,
    '3. DONE report includes branch name in frontmatter.',
    '',
  ].join('\n');

  // Write updated content back to QUEUED file (same ID).
  const queuedPath = path.join(QUEUE_DIR, `${id}-QUEUED.md`);
  try {
    fs.writeFileSync(queuedPath, updatedContent);
    log('info', 'nog', { id, msg: `Rewrote slice ${id} as ${id}-QUEUED.md (apendment round ${round})`, round, rootId });
  } catch (err) {
    log('warn', 'nog', { id, msg: 'Failed to write apendment QUEUED', error: err.message });
  }

  // Remove the EVALUATING file (the old DONE renamed by poll loop).
  try { fs.unlinkSync(evaluatingPath); } catch (_) {}
}

// ---------------------------------------------------------------------------
// ERROR file (written by orchestrator on invocation failure or invalid slice)
// ---------------------------------------------------------------------------

/**
 * writeErrorFile(errorPath, id, reason, err, stdout, stderr)
 *
 * Writes a structured ERROR report. The frontmatter always includes `reason`
 * so bridge.log and Chief O'Brien's tooling can distinguish failure modes:
 *   "timeout"             — process was killed after exceeding the timeout
 *   "crash"               — process exited non-zero; exit_code included
 *   "no_report"           — process exited 0 but wrote no DONE file
 *   "invalid_slice"   — QUEUED file failed frontmatter validation
 *
 * @param {string}      errorPath  Absolute path for the ERROR file.
 * @param {string}      id         Slice ID.
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
    `title: "Slice ${id} — ${reason}"`,
    'from: orchestrator',
    'to: chiefobrien',
    'status: ERROR',
    `slice_id: "${id}"`,
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
  const stdoutBody = isRomSelfTerminated(reason) ? truncate(stdout, 500) : (stdout || '(empty)');
  const stderrBody = isRomSelfTerminated(reason) ? truncate(stderr, 500) : (stderr || '(empty)');

  const detail = reason === 'timeout'
    ? 'The process was killed after exceeding the configured timeout.'
    : reason === 'inactivity_timeout'
      ? `The process was killed after ${extra && extra.lastActivitySecondsAgo != null ? extra.lastActivitySecondsAgo : '?'}s of no stdout/stderr output (limit: ${extra && extra.inactivityLimitMinutes != null ? extra.inactivityLimitMinutes : '?'} min).`
      : reason === 'crash'
        ? `The process exited with a non-zero status (exit code ${exitCode ?? 'unknown'}).`
        : reason === 'rom_no_commits'
          ? `Rom wrote a DONE report but made no commits to slice/${id}. The report is fabricated (likely hit a rate limit or crashed early). ${extra && extra.detail ? extra.detail : ''}`
          : reason === 'metrics_divergence'
            ? `Rom's claimed metrics diverged from the actual process metrics by >10×. ${extra && extra.detail ? extra.detail : ''}`
            : isRomSelfTerminated(reason)
              ? `The process exited cleanly but wrote no DONE file (${reason}).${extra && extra.rescue_path ? ' Worktree rescued to ' + extra.rescue_path + '.' : ''}`
              : `Slice frontmatter validation failed. Missing fields: ${(extra && extra.missingFields || []).join(', ')}.`;

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

  // Write structured JSON error record for the Ops Center API
  try {
    const errorsDir = path.resolve(__dirname, 'errors');
    if (!fs.existsSync(errorsDir)) fs.mkdirSync(errorsDir, { recursive: true });
    const lastOutput = ((stdout || '') + (stderr || '')).slice(-2000) || '';
    const jsonRecord = {
      ts: completed,
      slice_id: String(id),
      reason: reason,
      exitCode: exitCode != null ? Number(exitCode) : null,
      signal: signal || null,
      lastOutput,
      durationMs: (extra && extra.durationMs != null) ? extra.durationMs : null,
    };
    fs.writeFileSync(path.join(errorsDir, `${id}-ERROR.json`), JSON.stringify(jsonRecord, null, 2));
  } catch (_) {
    // Must never crash the orchestrator
  }
}

// ---------------------------------------------------------------------------
// Control file processing — return-to-stage and other UI-initiated actions
// ---------------------------------------------------------------------------

/**
 * Terminal file suffixes for slices eligible for return-to-stage.
 * Maps suffix → the terminal event name that produced it.
 */
const TERMINAL_SUFFIXES = [
  { suffix: '-ACCEPTED.md', event: 'ACCEPTED' },
  { suffix: '-STUCK.md',    event: 'MAX_ROUNDS_EXHAUSTED' },
  { suffix: '-ERROR.md',    event: 'ERROR' },
];

/**
 * handleReturnToStage(sliceId)
 *
 * Validates the slice is in a terminal state, emits RETURN_TO_STAGE, and
 * moves the slice file back into bridge/staged/ with status: STAGED.
 * Returns { ok, error } for the caller to log.
 */
function handleReturnToStage(sliceId) {
  const id = String(sliceId);

  // Reject if currently active (IN_PROGRESS or EVALUATING).
  const activeSuffixes = ['-IN_PROGRESS.md', '-EVALUATING.md', '-IN_REVIEW.md'];
  for (const s of activeSuffixes) {
    if (fs.existsSync(path.join(QUEUE_DIR, `${id}${s}`))) {
      return { ok: false, error: `Slice ${id} is currently active (${s.replace(/^-|\.md$/g, '')}) — cannot return to stage` };
    }
  }

  // Also reject QUEUED/PENDING (not yet started).
  if (fs.existsSync(path.join(QUEUE_DIR, `${id}-QUEUED.md`)) ||
      fs.existsSync(path.join(QUEUE_DIR, `${id}-PENDING.md`))) {
    return { ok: false, error: `Slice ${id} is QUEUED — cannot return to stage (not terminal)` };
  }

  // Find the terminal file.
  let terminalPath = null;
  let fromEvent = null;
  for (const { suffix, event } of TERMINAL_SUFFIXES) {
    const p = path.join(QUEUE_DIR, `${id}${suffix}`);
    if (fs.existsSync(p)) {
      terminalPath = p;
      fromEvent = event;
      break;
    }
  }

  // Also check PARKED (stuck from Nog escalation) — Nog escalation renames to STUCK.
  // And check staged dir for STAGED files that might be re-returned.
  if (!terminalPath) {
    // Check if slice exists at all in any known state.
    const anyFile = fs.readdirSync(QUEUE_DIR).find(f => f.startsWith(`${id}-`));
    if (anyFile) {
      return { ok: false, error: `Slice ${id} is in state ${anyFile} — not a terminal state eligible for return` };
    }
    // Check staged dir.
    const stagedFile = fs.readdirSync(STAGED_DIR).find(f => f.startsWith(`${id}-`));
    if (stagedFile) {
      return { ok: false, error: `Slice ${id} is already STAGED` };
    }
    return { ok: false, error: `Slice ${id} not found in queue or staged directory` };
  }

  // Read the terminal file content.
  let content;
  try {
    content = fs.readFileSync(terminalPath, 'utf-8');
  } catch (err) {
    return { ok: false, error: `Failed to read terminal file for slice ${id}: ${err.message}` };
  }

  // Also check the register for the most recent terminal event (more accurate fromEvent).
  try {
    const lines = fs.readFileSync(REGISTER_FILE, 'utf-8').trim().split('\n').filter(Boolean);
    const terminalEvents = ['MERGED', 'MAX_ROUNDS_EXHAUSTED', 'ESCALATED_TO_OBRIEN', 'ERROR', 'STUCK', 'NOG_ESCALATION'];
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i]);
        if (entry.id === id && terminalEvents.includes(entry.event)) {
          fromEvent = entry.event;
          break;
        }
      } catch (_) {}
    }
  } catch (_) {}

  // Emit RETURN_TO_STAGE register event.
  registerEvent(id, 'RETURN_TO_STAGE', {
    from_event: fromEvent,
    reason: 'manual',
  });

  // Update frontmatter status to STAGED and move to staged dir.
  const updatedContent = updateFrontmatter(content, { status: 'STAGED' });
  const stagedPath = path.join(STAGED_DIR, `${id}-STAGED.md`);
  try {
    fs.writeFileSync(stagedPath, updatedContent);
    fs.unlinkSync(terminalPath);
    log('info', 'control', { id, from: fromEvent, to: 'STAGED', msg: `Return-to-stage: moved slice ${id} from ${fromEvent} to STAGED` });
  } catch (err) {
    return { ok: false, error: `Failed to move slice ${id} to staged: ${err.message}` };
  }

  print(`  ${C.cyan}${SYM.back}${C.reset} Return-to-stage${SYM.sep}Slice ${id} (was ${fromEvent})${SYM.arrow}STAGED`);

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Pause / Resume / Abort helpers
// ---------------------------------------------------------------------------

/**
 * getLatestRegisterEvent(sliceId)
 *
 * Returns the latest register event for a given slice ID, or null.
 */
function getLatestRegisterEvent(sliceId) {
  const id = String(sliceId);
  try {
    const lines = fs.readFileSync(REGISTER_FILE, 'utf-8').trim().split('\n').filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i]);
        if ((entry.slice_id || entry.id) === id) return entry;
      } catch (_) {}
    }
  } catch (_) {}
  return null;
}

/**
 * getLatestLifecycleEvent(sliceId)
 *
 * Returns the latest *lifecycle* register event for a slice, skipping control-request
 * events (PAUSE_REQUESTED, RESUME_REQUESTED, ABORT_REQUESTED, and any other _REQUESTED
 * variants). This prevents dashboard-emitted request events from poisoning precondition
 * checks in handlePause/handleResume/handleAbort.
 */
function getLatestLifecycleEvent(sliceId) {
  const id = String(sliceId);
  try {
    const lines = fs.readFileSync(REGISTER_FILE, 'utf-8').trim().split('\n').filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i]);
        if ((entry.slice_id || entry.id) === id && !entry.event.endsWith('_REQUESTED')) return entry;
      } catch (_) {}
    }
  } catch (_) {}
  return null;
}

/**
 * getRoundFromRegister(sliceId)
 *
 * Derives the current round for a slice from COMMISSIONED events in the register.
 */
function getRoundFromRegister(sliceId) {
  const id = String(sliceId);
  let count = 0;
  let lastRound = null;
  try {
    const lines = fs.readFileSync(REGISTER_FILE, 'utf-8').trim().split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.id === id && entry.event === 'COMMISSIONED') {
          count++;
          if (entry.round != null) lastRound = parseInt(entry.round, 10);
        }
      } catch (_) {}
    }
  } catch (_) {}
  return lastRound || count || 1;
}

/**
 * handlePause(sliceId) — SIGSTOP the Rom subprocess for a slice.
 */
function handlePause(sliceId) {
  const id = String(sliceId);

  // Precondition: slice must be IN_PROGRESS with a live child.
  if (!fs.existsSync(path.join(QUEUE_DIR, `${id}-IN_PROGRESS.md`))) {
    return { ok: false, error: `Slice ${id} is not IN_PROGRESS — cannot pause` };
  }

  const entry = activeChildren.get(id);
  if (!entry || !entry.child || entry.child.exitCode !== null) {
    return { ok: false, error: `Slice ${id} has no live Rom subprocess — cannot pause` };
  }

  // Check latest lifecycle event — must be a live-Rom state, not already paused or terminal.
  const latest = getLatestLifecycleEvent(id);
  if (latest && latest.event === 'ROM_PAUSED') {
    return { ok: false, error: `Slice ${id} is already paused` };
  }
  const liveStates = ['COMMISSIONED', 'ROM_STARTED', 'ROM_RESUMED'];
  if (!latest || !liveStates.includes(latest.event)) {
    return { ok: false, error: `Slice ${id} is not in a pausable state (latest lifecycle: ${latest ? latest.event : 'none'})` };
  }

  try {
    process.kill(entry.child.pid, 'SIGSTOP');
  } catch (err) {
    return { ok: false, error: `Failed to SIGSTOP slice ${id}: ${err.message}` };
  }

  const round = getRoundFromRegister(id);
  registerEvent(id, 'ROM_PAUSED', { round });
  log('info', 'control', { id, msg: `Paused Rom subprocess (PID ${entry.child.pid})`, round });
  print(`  ${C.cyan}${SYM.back}${C.reset} Pause${SYM.sep}Slice ${id} paused (round ${round})`);

  return { ok: true };
}

/**
 * handleResume(sliceId) — SIGCONT the Rom subprocess for a slice.
 */
function handleResume(sliceId) {
  const id = String(sliceId);

  // Precondition: latest *lifecycle* event must be ROM_PAUSED.
  // Uses getLatestLifecycleEvent to skip dashboard-emitted _REQUESTED events
  // that would otherwise poison this check (e.g. RESUME_REQUESTED after ROM_PAUSED).
  const latest = getLatestLifecycleEvent(id);
  if (!latest || latest.event !== 'ROM_PAUSED') {
    return { ok: false, error: `Slice ${id} is not paused — cannot resume` };
  }

  const entry = activeChildren.get(id);
  if (!entry || !entry.child || entry.child.exitCode !== null) {
    return { ok: false, error: `Slice ${id} has no live Rom subprocess — cannot resume (child may have died while paused)` };
  }

  try {
    process.kill(entry.child.pid, 'SIGCONT');
  } catch (err) {
    return { ok: false, error: `Failed to SIGCONT slice ${id}: ${err.message}` };
  }

  const round = getRoundFromRegister(id);
  registerEvent(id, 'ROM_RESUMED', { round });
  log('info', 'control', { id, msg: `Resumed Rom subprocess (PID ${entry.child.pid})`, round });
  print(`  ${C.cyan}${SYM.back}${C.reset} Resume${SYM.sep}Slice ${id} resumed (round ${round})`);

  return { ok: true };
}

/**
 * handleAbort(sliceId) — SIGKILL the Rom subprocess, clean up, return to STAGED.
 */
function handleAbort(sliceId) {
  const id = String(sliceId);

  // Precondition: slice must be IN_PROGRESS (active or paused).
  const inProgressPath = path.join(QUEUE_DIR, `${id}-IN_PROGRESS.md`);
  if (!fs.existsSync(inProgressPath)) {
    return { ok: false, error: `Slice ${id} is not IN_PROGRESS — cannot abort` };
  }

  const entry = activeChildren.get(id);
  if (entry && entry.child && entry.child.exitCode === null) {
    // If paused, resume first so SIGKILL is delivered immediately.
    const latest = getLatestLifecycleEvent(id);
    if (latest && latest.event === 'ROM_PAUSED') {
      try { process.kill(entry.child.pid, 'SIGCONT'); } catch (_) {}
    }
    try {
      process.kill(entry.child.pid, 'SIGKILL');
    } catch (err) {
      log('warn', 'control', { id, msg: `Failed to SIGKILL Rom subprocess: ${err.message}` });
    }
  }

  // Clean up worktree.
  const worktreePath = entry ? entry.worktreePath : getWorktreePath(id);
  try {
    cleanupWorktree(id, `slice/${id}`);
  } catch (err) {
    log('warn', 'control', { id, msg: `Worktree cleanup failed during abort: ${err.message}` });
  }

  // Move slice back to STAGED.
  let content;
  try {
    content = fs.readFileSync(inProgressPath, 'utf-8');
  } catch (err) {
    return { ok: false, error: `Failed to read IN_PROGRESS file for slice ${id}: ${err.message}` };
  }

  const updatedContent = updateFrontmatter(content, { status: 'STAGED' });
  const stagedPath = path.join(STAGED_DIR, `${id}-STAGED.md`);
  try {
    fs.writeFileSync(stagedPath, updatedContent);
    fs.unlinkSync(inProgressPath);
  } catch (err) {
    return { ok: false, error: `Failed to move slice ${id} to staged: ${err.message}` };
  }

  // Remove from active children and reset processing.
  activeChildren.delete(id);
  processing = false;
  heartbeatState.status = 'idle';
  heartbeatState.current_slice = null;
  heartbeatState.current_slice_title = null;
  heartbeatState.current_slice_goal = null;
  heartbeatState.pickupTime = null;
  writeHeartbeat();

  const round = getRoundFromRegister(id);
  registerEvent(id, 'ROM_ABORTED', { round, reason: 'manual' });
  log('info', 'control', { id, msg: `Aborted Rom subprocess — slice returned to STAGED`, round });
  print(`  ${C.cyan}${SYM.back}${C.reset} Abort${SYM.sep}Slice ${id} aborted (round ${round})${SYM.arrow}STAGED`);

  return { ok: true };
}

/**
 * processControlFiles()
 *
 * Scans bridge/control/ for JSON control files and processes each action.
 * Control files are consumed (moved to trash) after processing.
 * Called at the start of each poll cycle.
 */
function processControlFiles() {
  let files;
  try {
    files = fs.readdirSync(CONTROL_DIR).filter(f => f.endsWith('.json'));
  } catch (_) {
    return;
  }

  for (const file of files) {
    const filePath = path.join(CONTROL_DIR, file);
    let request;
    try {
      request = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (err) {
      log('warn', 'control', { file, msg: 'Malformed control file — skipping', error: err.message });
      try { fs.renameSync(filePath, path.join(TRASH_DIR, file + '.malformed')); } catch (_) {}
      continue;
    }

    const action = request.action;
    const sliceId = request.slice_id;

    if (!action || !sliceId) {
      log('warn', 'control', { file, msg: 'Control file missing action or slice_id', request });
      try { fs.renameSync(filePath, path.join(TRASH_DIR, file + '.invalid')); } catch (_) {}
      continue;
    }

    let result;
    if (action === 'return_to_stage') {
      result = handleReturnToStage(sliceId);
    } else if (action === 'pause') {
      result = handlePause(sliceId);
    } else if (action === 'resume') {
      result = handleResume(sliceId);
    } else if (action === 'abort') {
      result = handleAbort(sliceId);
    } else {
      log('warn', 'control', { file, msg: `Unknown control action: ${action}`, action, sliceId });
      result = null;
    }

    if (result && !result.ok) {
      log('warn', 'control', { file, action, sliceId, msg: result.error });
    } else if (result) {
      log('info', 'control', { file, action, sliceId, msg: `${action} completed` });
    }

    // Consume the control file regardless of success/failure.
    try { fs.renameSync(filePath, path.join(TRASH_DIR, file + '.processed')); } catch (_) {}
  }
}

// ---------------------------------------------------------------------------
// Poll cycle
// ---------------------------------------------------------------------------

function poll() {
  // Always process control files — pause/resume/abort must work even while processing.
  processControlFiles();

  if (processing) return;

  // Cycle-start sweep: prune orphan locks and worktree dirs before dispatch.
  // Returns false when STALE_LOCK_DETECTED — skip dispatch to avoid hitting the same lock.
  try {
    const shouldDispatch = gitFinalizer.sweepStaleResources();
    if (shouldDispatch === false) {
      log('info', 'sweep', { msg: 'sweepStaleResources signalled skip-dispatch (STALE_LOCK_DETECTED)' });
      return;
    }
  } catch (err) {
    log('warn', 'sweep', { msg: 'sweepStaleResources threw — skipping dispatch this tick', error: err.message });
    return;
  }

  // Rate limit gate: pause dispatch until the API limit resets.
  if (rateLimitUntil) {
    const remaining = rateLimitUntil - Date.now();
    if (remaining > 0) {
      // Print a reminder every ~5 minutes (60 poll cycles at 5s).
      idlePrintCounter += 1;
      if (idlePrintCounter >= 60) {
        idlePrintCounter = 0;
        print(`  ${C.yellow}⏸${C.reset}  Rate limited — ${Math.ceil(remaining / 60000)} min remaining until dispatch resumes`);
      }
      return;
    }
    // Limit has lifted.
    rateLimitUntil = null;
    print(`  ${C.green}${SYM.check}${C.reset} Rate limit window passed — resuming dispatch`);
  }

  let files;
  try {
    files = fs.readdirSync(QUEUE_DIR);
  } catch (err) {
    log('error', 'error', { msg: 'Failed to read queue directory', error: err.message });
    return;
  }

  // Scan both DONE and QUEUED/PENDING up front so counts are available for logging.
  const doneFiles = files.filter(f => f.endsWith('-DONE.md')).sort();
  const pendingFiles = files
    .filter(f => f.endsWith('-QUEUED.md') || f.endsWith('-PENDING.md'))
    .sort((a, b) => {
      // Priority sorting: apendments (rejections) jump the queue.
      // Read frontmatter to check for apendment_cycle/amendment_cycle or references field.
      const isApendmentA = (() => {
        try {
          const content = fs.readFileSync(path.join(QUEUE_DIR, a), 'utf-8');
          const meta = parseFrontmatter(content);
          return meta && (meta.type === 'amendment' || !!meta.apendment || !!meta.amendment || (parseInt(meta.round, 10) > 1) || (meta.references && meta.references !== 'null'));
        } catch (_) { return false; }
      })();
      const isApendmentB = (() => {
        try {
          const content = fs.readFileSync(path.join(QUEUE_DIR, b), 'utf-8');
          const meta = parseFrontmatter(content);
          return meta && (meta.type === 'amendment' || !!meta.apendment || !!meta.amendment || (parseInt(meta.round, 10) > 1) || (meta.references && meta.references !== 'null'));
        } catch (_) { return false; }
      })();
      // Apendments sort before fresh slices
      if (isApendmentA && !isApendmentB) return -1;
      if (!isApendmentA && isApendmentB) return 1;
      // Within same priority: lexicographic (numeric FIFO)
      return a.localeCompare(b);
    });

  // === Priority 1: Evaluate completed DONE files first ===
  // This ensures each build merges to main BEFORE the next build starts,
  // preventing branch divergence when multiple slices are approved in a burst.
  for (const doneFile of doneFiles) {
    const doneId = doneFile.replace('-DONE.md', '');
    const donePath = path.join(QUEUE_DIR, doneFile);
    const parkedPath = path.join(QUEUE_DIR, `${doneId}-PARKED.md`);
    const legacyParkedPath = path.join(QUEUE_DIR, `${doneId}-ARCHIVED.md`);

    // Skip if PARKED file not present (Rom may still be running — park not yet written).
    if (!fs.existsSync(parkedPath)) {
      if (fs.existsSync(legacyParkedPath)) {
        log('warn', 'state', { id: doneId, msg: 'Legacy ARCHIVED suffix found — pre-slice-145 file' });
      } else {
        continue;
      }
    }

    // Legacy: merge slices (type: merge) are auto-accepted without claude -p.
    // Deprecated: handleAccepted() now merges directly — no new merge slices
    // are generated. This block handles any legacy merge slices still in the queue.
    let sliceMeta = {};
    try {
      const resolvedPath = fs.existsSync(parkedPath) ? parkedPath : legacyParkedPath;
      sliceMeta = parseFrontmatter(fs.readFileSync(resolvedPath, 'utf-8')) || {};
    } catch (_) {}

    if (sliceMeta.type === 'merge') {
      log('info', 'evaluator', { id: doneId, msg: 'Legacy merge slice auto-accepted (deprecated path)' });
      const acceptedPath = path.join(QUEUE_DIR, `${doneId}-ACCEPTED.md`);
      try { fs.renameSync(donePath, acceptedPath); } catch (_) {}
      // Canonical: NOG_DECISION (auto-accepted merge)
      registerEvent(doneId, 'NOG_DECISION', { verdict: 'ACCEPTED', reason: 'auto-accepted merge', cycle: 0, round: 0 });
      print(`  ${C.green}${SYM.check}${C.reset} Slice ${doneId}${SYM.dash}Merge auto-accepted`);
      continue;
    }

    // Skip if the current attempt has already been accepted + merged. Rejected verdicts are NOT terminal — Rom reworks and the next DONE must re-dispatch.
    if (hasReviewEvent(doneId)) continue;

    // Rom slice-broken fast path (BR invariant #9):
    // If Rom's DONE report contains "## Rom Escalation — Slice Broken",
    // route directly to STAGED for O'Brien rework — skip Nog entirely.
    try {
      const doneContent = fs.readFileSync(donePath, 'utf-8');
      if (/^## Rom Escalation — Slice Broken\s*$/m.test(doneContent)) {
        fs.renameSync(donePath, path.join(STAGED_DIR, `${doneId}-STAGED.md`));
        registerEvent(doneId, 'ROM_ESCALATE', { reason: 'slice-broken fast path' });
        log('info', 'state', { id: doneId, from: 'DONE', to: 'STAGED', reason: 'rom_escalate' });
        continue;
      }
    } catch (err) {
      log('warn', 'evaluator', { id: doneId, msg: 'Failed to read DONE file for Rom escalation check', error: err.message });
    }

    // Rename DONE → EVALUATING to claim it.
    const evaluatingPath = path.join(QUEUE_DIR, `${doneId}-EVALUATING.md`);
    try {
      fs.renameSync(donePath, evaluatingPath);
      log('info', 'state', { id: doneId, from: 'DONE', to: 'EVALUATING' });
    } catch (err) {
      log('warn', 'evaluator', { id: doneId, msg: 'Failed to rename DONE to EVALUATING', error: err.message });
      continue;
    }

    if (pendingFiles.length > 0) {
      log('info', 'evaluator', { id: doneId, msg: `Evaluating DONE before ${pendingFiles.length} pending — merge-first priority` });
      print(`${B.vert}  ${C.yellow}⚡${C.reset} ${pendingFiles.length} pending held — evaluating #${doneId} first (merge-first priority)`);
    }

    processing = true;
    heartbeatState.current_slice = doneId;
    heartbeatState.current_slice_goal = sliceMeta.goal || null;
    heartbeatState.pickupTime = Date.now();

    // Route: single Nog pass covers code review + ACs + intent + scope.
    const resolvedParked = fs.existsSync(parkedPath) ? parkedPath : legacyParkedPath;
    let waitRound = 1;
    try {
      const parkedContent = fs.readFileSync(resolvedParked, 'utf-8');
      const nogRounds = (parkedContent.match(/^## Nog Review — Round \d+/gm) || []).length;
      waitRound = nogRounds + 1;
    } catch (_) {}
    registerEvent(doneId, 'NOG_INVOKED', { round: waitRound });

    heartbeatState.status = 'nog_review';
    writeHeartbeat();
    invokeNog(doneId);
    return;
  }

  // === Priority 2: Commission next QUEUED slice (only if no DONE files to evaluate) ===
  if (pendingFiles.length === 0) {
    // ALL_COMPLETE check: pipeline is idle after processing at least one slice this session.
    const hasInProgress = files.some(f => f.endsWith('-IN_PROGRESS.md'));
    if (sessionHasProcessed && !hasInProgress) {
      appendKiraEvent({
        event: 'ALL_COMPLETE',
        slice_id: null,
        root_id: null,
        cycle: null,
        branch: null,
        details: 'All active slices are terminal. Pipeline idle.',
      });
      sessionHasProcessed = false;
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

  // Derive the slice ID from the filename (e.g. "003-QUEUED.md" → "003").
  const id = pendingFile.replace(/-(?:QUEUED|PENDING)\.md$/, '');

  // Read slice content.
  let sliceContent;
  try {
    sliceContent = fs.readFileSync(pendingPath, 'utf-8');
  } catch (err) {
    log('error', 'error', { id, msg: 'Failed to read QUEUED file', error: err.message });
    return;
  }

  // Parse frontmatter for timeout_min override and title.
  const meta = parseFrontmatter(sliceContent);
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
  //   - Do NOT rename to IN_PROGRESS (file stays as QUEUED/PENDING for inspection)
  //   - Write an ERROR report immediately
  //   - Log with reason "invalid_slice"
  //   - Remove the QUEUED/PENDING file so the poll loop doesn't re-process it forever
  //   - Continue the poll loop (do not crash)
  // ---------------------------------------------------------------------------
  const { missingFields } = validateIntakeMeta(meta);

  if (missingFields.length > 0) {
    const errId   = (meta && meta.id) || id;
    const errPath = path.join(QUEUE_DIR, `${errId}-ERROR.md`);

    log('error', 'error', {
      id: errId,
      msg: 'Slice rejected — missing required frontmatter fields',
      reason: 'invalid_slice',
      missing_fields: missingFields,
      file: pendingFile,
    });

    // Stakeholder-friendly terminal output for rejected slices.
    print(`  ${C.red}${SYM.cross}${C.reset} Slice ${errId} rejected${SYM.dash}Missing required fields: ${missingFields.join(', ')}`);

    writeErrorFile(errPath, errId, 'invalid_slice', null, '', '', { missingFields });
    log('info', 'state', { id: errId, from: 'QUEUED', to: 'ERROR', reason: 'invalid_slice' });
    registerEvent(errId, 'ERROR', {
      reason: 'invalid_slice',
      phase: 'validation',
      command: null,
      exit_code: null,
      stderr_tail: '',
      missingFields,
    });
    appendKiraEvent({
      event: 'ERROR',
      slice_id: errId,
      root_id: null,
      cycle: null,
      branch: null,
      details: `Slice ${errId} errored: invalid_slice`,
    });

    // Remove the invalid QUEUED/PENDING file so it doesn't loop indefinitely.
    try { fs.renameSync(pendingPath, path.join(TRASH_DIR, path.basename(pendingPath) + '.invalid')); } catch (_) {}

    return; // Continue poll loop on next tick.
  }

  // Atomic rename: QUEUED → IN_PROGRESS.
  try {
    fs.renameSync(pendingPath, inProgressPath);
  } catch (err) {
    log('error', 'error', { id, msg: 'Failed to rename QUEUED to IN_PROGRESS', error: err.message });
    return;
  }

  log('info', 'pickup', { id, title, msg: 'Slice picked up', file: pendingFile });
  log('info', 'state', { id, from: 'QUEUED', to: 'IN_PROGRESS' });

  // Register: embed full slice body so success criteria are always recoverable.
  registerCommissioned(id, { title, goal, body: sliceContent });

  openSliceBlock(id, title, goal);

  processing = true;

  // Invoke Rom asynchronously — event loop stays live.
  invokeRom(sliceContent, donePath, inProgressPath, errorPath, id, effectiveInactivityMs, title, goal);
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
 *   {id}-IN_PROGRESS alone            → rename back to QUEUED (re-queue)
 *   {id}-IN_PROGRESS + DONE exists    → delete IN_PROGRESS (already complete)
 *   {id}-IN_PROGRESS + ERROR exists   → delete IN_PROGRESS (already failed)
 *   {id}-IN_PROGRESS + ACCEPTED exists → delete IN_PROGRESS (already evaluated)
 *   {id}-IN_PROGRESS + SLICE exists   → delete IN_PROGRESS (already archived)
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

    // Read title from PARKED file (fall back to legacy ARCHIVED).
    const parkedTitlePath = path.join(QUEUE_DIR, `${id}-PARKED.md`);
    const legacyTitlePath = path.join(QUEUE_DIR, `${id}-ARCHIVED.md`);
    try {
      const commContent = fs.readFileSync(fs.existsSync(parkedTitlePath) ? parkedTitlePath : legacyTitlePath, 'utf-8');
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
      // Fast path: check if ref still exists and is in main's ancestry
      gitFinalizer.runGit(`git rev-parse --verify "${branchName}"`, { slice_id: id, op: 'startupRecovery_verifyRef', encoding: 'utf-8' });
      const merged = gitFinalizer.runGit('git branch --merged main', { slice_id: id, op: 'startupRecovery_mergedCheck', encoding: 'utf-8' });
      alreadyMerged = merged.split('\n').some(line => line.trim() === branchName);
    } catch (_) {
      // Branch ref is gone (deleted after worktree cleanup) — check register
      alreadyMerged = hasMergedEvent(id);
    }

    if (alreadyMerged) {
      log('info', 'startup_recovery', { id, msg: `Branch ${branchName} already on main — no merge needed`, branch: branchName });
      actions.push({ id, type: 'accepted_already_merged', branch: branchName });
      continue;
    }

    // Re-attempt merge.
    const result = mergeBranch(id, branchName, title);
    if (result.success) {
      registerEvent(id, 'MERGED', { branch: branchName, sha: result.sha, slice_id: id, recovery: true });
      log('info', 'startup_recovery', { id, msg: `Recovery merge succeeded for ${branchName}`, branch: branchName, sha: result.sha });
      actions.push({ id, type: 'recovery_merged', branch: branchName, sha: result.sha });
    } else {
      registerEvent(id, 'MERGE_FAILED', { branch: branchName, reason: result.error, slice_id: id, recovery: true });
      log('warn', 'startup_recovery', { id, msg: `Recovery merge failed for ${branchName}`, branch: branchName, reason: result.error });
      actions.push({ id, type: 'recovery_merge_failed', branch: branchName, reason: result.error });
      printUnmergedAlert(id, title, branchName);
    }
  }

  const inProgressFiles = files.filter(f => f.endsWith('-IN_PROGRESS.md'));
  if (inProgressFiles.length === 0) return actions;

  for (const file of inProgressFiles) {
    const id             = file.replace('-IN_PROGRESS.md', '');
    const inProgressPath = path.join(QUEUE_DIR, file);
    const hasDone        = fs.existsSync(path.join(QUEUE_DIR, `${id}-DONE.md`));
    const hasError       = fs.existsSync(path.join(QUEUE_DIR, `${id}-ERROR.md`));
    const hasAccepted    = fs.existsSync(path.join(QUEUE_DIR, `${id}-ACCEPTED.md`));
    const hasParked      = fs.existsSync(path.join(QUEUE_DIR, `${id}-PARKED.md`));
    const hasArchived    = fs.existsSync(path.join(QUEUE_DIR, `${id}-ARCHIVED.md`));

    if (hasDone || hasError || hasAccepted || hasParked || hasArchived) {
      // Slice already resolved — the IN_PROGRESS file is a stale artifact.
      const resolvedAs = hasDone ? 'DONE' : hasError ? 'ERROR' : hasAccepted ? 'ACCEPTED' : hasParked ? 'PARKED' : 'ARCHIVED';
      try {
        fs.renameSync(inProgressPath, path.join(TRASH_DIR, path.basename(inProgressPath) + '.orphan'));
        log('info', 'startup_recovery', {
          id,
          msg: `Orphaned IN_PROGRESS trashed (${resolvedAs} present)`,
          action: 'trashed',
          resolved_as: resolvedAs,
        });
        actions.push({ id, type: hasDone ? 'cleared' : hasAccepted ? 'cleared_accepted' : hasSlice ? 'cleared_slice' : 'cleared_error' });
      } catch (err) {
        log('warn', 'startup_recovery', { id, msg: 'Failed to delete orphaned IN_PROGRESS', error: err.message });
      }
    } else {
      // Check if slice was paused when the orchestrator restarted.
      const latestEvent = getLatestRegisterEvent(id);
      if (latestEvent && latestEvent.event === 'ROM_PAUSED') {
        // Slice was paused — leave it IN_PROGRESS but block new dispatches.
        // The child process is gone (orchestrator restarted), so emit a
        // paused_child_died error so the UI can prompt Abort + re-stage.
        processing = true;
        heartbeatState.status = 'processing';
        heartbeatState.current_slice = id;
        registerEvent(id, 'ERROR', {
          phase: 'paused_child_died',
          reason: 'Watcher restarted while slice was paused — child process lost',
          stderr_tail: '',
        });
        log('info', 'startup_recovery', {
          id,
          msg: 'Paused slice found on restart — child lost, ERROR emitted. Awaiting Resume/Abort.',
          action: 'paused_orphan',
        });
        actions.push({ id, type: 'paused_orphan' });
      } else {
        // No resolution file — slice was interrupted mid-flight. Re-queue it.
        const queuedPath = path.join(QUEUE_DIR, `${id}-QUEUED.md`);
        try {
          fs.renameSync(inProgressPath, queuedPath);  // atomic rename
          log('info', 'startup_recovery', {
            id,
            msg: 'Orphaned IN_PROGRESS renamed to QUEUED (re-queued)',
            action: 're-queued',
          });
          actions.push({ id, type: 'requeued' });
        } catch (err) {
          log('warn', 'startup_recovery', { id, msg: 'Failed to rename orphaned IN_PROGRESS to QUEUED', error: err.message });
        }
      }
    }
  }

  return actions;
}

// ---------------------------------------------------------------------------
// Slice ID management (3.2)
// ---------------------------------------------------------------------------

/**
 * nextSliceId(queueDir)
 *
 * Reads all filenames in queueDir, extracts their numeric prefix IDs, and
 * returns the next ID as a zero-padded three-digit string (e.g. "009").
 * Returns "001" if the directory is empty or unreadable.
 *
 * This function is purely computational — it does not write any files.
 * Exported so the orchestrator can call it from bridge/next-id.js.
 */
function nextSliceId(queueDir) {
  const stagedDir = path.join(path.dirname(queueDir), 'staged');
  const ids = [];

  for (const dir of [queueDir, stagedDir]) {
    let files;
    try {
      files = fs.readdirSync(dir);
    } catch (_) {
      continue;
    }
    for (const f of files) {
      const m = f.match(/^(\d+)-/);
      if (m) ids.push(parseInt(m[1], 10));
    }
  }

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
      msg: 'A slice is in flight at shutdown. The IN_PROGRESS file will be recovered by crash recovery (Layer 3) on next startup.',
      current_slice: heartbeatState.current_slice,  // internal key name kept for state compat
    });
    print('');
    print(`  Watcher shutting down${SYM.dash}slice in progress will be recovered on next start.`);
  }
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// ---------------------------------------------------------------------------
// One-shot bootstrap: rescue DONE files wedged by stale pre-RESTAGED reviews
// ---------------------------------------------------------------------------

/**
 * restagedBootstrap(opts)
 *
 * Runs once per install (guarded by RESTAGED_BOOTSTRAP_MARKER).
 * Scans queue for *-DONE.md files that have a stale NOG_DECISION/MERGED/STUCK
 * in the register but no RESTAGED marker yet. Appends a synthetic RESTAGED so
 * the new scoped hasReviewEvent returns false and the DONE can advance to Nog.
 *
 * Accepts optional {queueDir, regFile, markerFile} for testing.
 */
function restagedBootstrap(opts) {
  const queueDir   = (opts && opts.queueDir)   || QUEUE_DIR;
  const regFile    = (opts && opts.regFile)    || REGISTER_FILE;
  const markerFile = (opts && opts.markerFile) || RESTAGED_BOOTSTRAP_MARKER;

  if (fs.existsSync(markerFile)) return;

  let doneFiles;
  try {
    doneFiles = fs.readdirSync(queueDir).filter(f => /^\d+-DONE\.md$/.test(f));
  } catch (_) { return; }

  for (const file of doneFiles) {
    const id = file.replace('-DONE.md', '');
    if (latestRestagedTs(id, regFile) !== null) continue; // already has RESTAGED

    let hasStale = false;
    try {
      const lines = fs.readFileSync(regFile, 'utf-8').trim().split('\n').filter(Boolean);
      resetDedupeState();
      for (const line of lines) {
        try {
          const raw = JSON.parse(line);
          const entry = translateEvent(raw);
          if (entry && entry.id === String(id) && ['NOG_DECISION', 'MERGED', 'STUCK'].includes(entry.event)) {
            hasStale = true;
            break;
          }
        } catch (_) {}
      }
    } catch (_) {}

    if (hasStale) {
      const rescueEntry = { ts: new Date().toISOString(), event: 'RESTAGED', slice_id: String(id) };
      try {
        fs.appendFileSync(regFile, JSON.stringify(rescueEntry) + '\n');
        log('info', 'bootstrap', { id, msg: 'RESTAGED rescue appended for wedged DONE' });
      } catch (err) {
        log('warn', 'bootstrap', { id, msg: 'Failed to append RESTAGED rescue', error: err.message });
      }
    }
  }

  try {
    fs.writeFileSync(markerFile, new Date().toISOString() + '\n');
  } catch (err) {
    log('warn', 'bootstrap', { msg: 'Failed to write bootstrap marker', error: err.message });
  }
}

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

  // Remove stale git lock files from prior crashes before any git operations.
  clearStaleGitLocks();

  // Initialise git-finalizer with orchestrator dependencies.
  gitFinalizer.init({ PROJECT_DIR, registerEvent, log, HEARTBEAT_FILE, QUEUE_DIR });

  // Clean up .dead worktree/branch entries from prior sessions.
  cleanupDeadWorktrees();

  const recoveryActions = crashRecovery();
  restagedBootstrap();
  printStartupBlock(recoveryActions);

  // Initial heartbeat write so the file exists immediately on startup.
  writeHeartbeat();

  // Start heartbeat interval.
  setInterval(writeHeartbeat, config.heartbeatIntervalMs);

  // Start poll interval + immediate first poll.
  setInterval(poll, config.pollIntervalMs);
  poll();

  // -------------------------------------------------------------------------
  // Writer-split: watch for external changes to per-role JSONL files.
  // When Kira (or any other role) appends to e.g. timesheet-kira.jsonl via
  // Wormhole, rebuild the merged view so readers see the new data.
  // -------------------------------------------------------------------------
  const SPLIT_BASES = ['timesheet', 'anchors', 'tt-audit'];
  const rebuildDebounce = {};

  fs.watch(__dirname, (eventType, filename) => {
    if (!filename || !filename.endsWith('.jsonl')) return;
    for (const base of SPLIT_BASES) {
      // Match per-role files like timesheet-kira.jsonl but not the merged timesheet.jsonl
      if (filename.startsWith(`${base}-`) && filename !== `${base}.jsonl`) {
        // Debounce: multiple change events fire in rapid succession
        if (rebuildDebounce[base]) clearTimeout(rebuildDebounce[base]);
        rebuildDebounce[base] = setTimeout(() => {
          rebuildMerged(base);
          rebuildDebounce[base] = null;
        }, 200);
        break;
      }
    }
  });
}

// ---------------------------------------------------------------------------
// validateIntakeMeta — intake field validation for the poll loop
//
// Rework/apendment files carry rounds[], round>1, or apendment/references
// signals and only need 4 fields (id, title, from, to); the priority +
// created pair was captured in the original COMMISSIONED event.
// ---------------------------------------------------------------------------

function validateIntakeMeta(meta) {
  const isApendmentFile = !!(meta && (
    meta.type === 'amendment' ||
    meta.apendment ||
    meta.amendment ||
    (meta.references && meta.references !== 'null') ||
    (parseInt(meta.round, 10) > 1) ||
    (Array.isArray(meta.rounds) && meta.rounds.length > 0)
  ));
  const REQUIRED_FIELDS = isApendmentFile
    ? ['id', 'title', 'from', 'to']
    : ['id', 'title', 'from', 'to', 'priority', 'created'];
  const missingFields = REQUIRED_FIELDS.filter(
    field => !meta || !meta[field] || meta[field].trim() === ''
  );
  return { ok: missingFields.length === 0, missingFields };
}

// ---------------------------------------------------------------------------
// Exports — for use by helper scripts (e.g. bridge/next-id.js)
// ---------------------------------------------------------------------------

module.exports = { nextSliceId, getQueueSnapshot, classifyNoReportExit, rescueWorktree, isRomSelfTerminated, verifyRomActuallyWorked, assertMergeIntegrity, latestRestagedTs, latestAttemptStartTs, hasReviewEvent, hasMergedEvent, restagedBootstrap, validateIntakeMeta, ensureMainIsFresh, _testSetRegisterFile: (p) => { REGISTER_FILE = p; } };
