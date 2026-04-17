'use strict';

const fs = require('fs');
const path = require('path');
const { execFile, execSync } = require('child_process');
const { appendTimesheet, updateTimesheet, rebuildMerged } = require('./slicelog');
const { appendKiraEvent } = require('./kira-events');
const { buildNogPrompt } = require('./nog-prompt');

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
const STAGED_DIR     = path.resolve(__dirname, 'staged');
const LOG_FILE       = path.resolve(__dirname, config.logFile);
const HEARTBEAT_FILE = path.resolve(__dirname, config.heartbeatFile);
const PROJECT_DIR    = path.resolve(__dirname, config.projectDir);
const REGISTER_FILE  = path.resolve(__dirname, 'register.jsonl');
const NOG_ACTIVE_FILE = path.resolve(__dirname, 'nog-active.json');
const TRASH_DIR      = path.resolve(QUEUE_DIR, '..', 'trash');
const WORKTREE_BASE  = '/tmp/ds9-worktrees';
const LOGS_DIR       = path.resolve(__dirname, 'logs');
const ESCALATIONS_DIR = path.resolve(__dirname, 'kira-escalations');

// Ensure queue + trash + logs + escalations directories exist.
fs.mkdirSync(QUEUE_DIR, { recursive: true });
fs.mkdirSync(TRASH_DIR, { recursive: true });
fs.mkdirSync(LOGS_DIR, { recursive: true });
fs.mkdirSync(ESCALATIONS_DIR, { recursive: true });

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
    const stagedFiles = fs.readdirSync(STAGED_DIR).filter(f => f.endsWith('-STAGED.md') || f.endsWith('-NEEDS_AMENDMENT.md'));
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
    // Log file write failure must not crash the watcher.
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

/**
 * registerCommissioned(id, extra)
 *
 * Writes a COMMISSIONED register event with one retry on failure.
 * A missing COMMISSIONED event means the history panel shows no title —
 * this is data loss, not a minor hiccup, so we retry and alert loudly.
 */
function registerCommissioned(id, extra) {
  const entry = Object.assign(
    { ts: new Date().toISOString(), id: String(id), event: 'COMMISSIONED' },
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
    const status = execSync('git status --porcelain', { cwd: PROJECT_DIR, encoding: 'utf-8' }).trim();
    // Only care about modified tracked files (M, D, R) — not untracked (??)
    const trackedChanges = status.split('\n').filter(l => l && !l.startsWith('??'));
    if (trackedChanges.length === 0) return false;

    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: PROJECT_DIR, encoding: 'utf-8' }).trim();
    const msg = `autocommit: ${reason} [${trackedChanges.length} file(s) on ${branch}]`;
    log('warn', 'git_safety', { msg, files: trackedChanges.map(l => l.trim()).join(', ') });

    execSync('git add -u', { cwd: PROJECT_DIR, stdio: 'pipe' }); // -u: only tracked files
    execSync(`git commit -m "${msg.replace(/"/g, '\\"')}"`, { cwd: PROJECT_DIR, stdio: 'pipe' });
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
 * Used for amendment flows where the watcher needs to resume work on
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
  const current = execSync('git rev-parse --abbrev-ref HEAD', { cwd, encoding: 'utf-8' }).trim();
  if (current !== expectedBranch) {
    issues.push(`HEAD is on '${current}', expected '${expectedBranch}'`);
  }

  // Check 2: commits ahead of main
  try {
    const ahead = execSync(`git rev-list main..${expectedBranch} --count`, { cwd, encoding: 'utf-8' }).trim();
    if (parseInt(ahead, 10) === 0) {
      issues.push(`Branch ${expectedBranch} has no commits ahead of main`);
    }
  } catch (_) {
    issues.push(`Could not count commits ahead of main for ${expectedBranch}`);
  }

  // Check 3: merge-base is on main (branch forked from main, not from some other branch)
  try {
    const mergeBase = execSync(`git merge-base main ${expectedBranch}`, { cwd, encoding: 'utf-8' }).trim();
    const mainTip   = execSync('git rev-parse main', { cwd, encoding: 'utf-8' }).trim();
    // The merge-base should be the main tip at branch creation time.
    // Verify it's reachable from main.
    const isOnMain = execSync(`git branch --contains ${mergeBase}`, { cwd, encoding: 'utf-8' });
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
    execSync('git merge --abort', { cwd: PROJECT_DIR, stdio: 'pipe' });
    log('info', 'startup', { msg: 'Aborted in-progress merge left from prior run' });
  } catch (_) {
    // No merge in progress — expected
  }
}

/**
 * selfRestart(reason)
 *
 * Spawns a fresh copy of the watcher process and exits this one.
 * Used when a hard-reset or lock-clearing operation needs a clean process state.
 */
function selfRestart(reason) {
  log('warn', 'self_restart', { msg: `Restarting watcher: ${reason}` });
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
 * Fetches from origin and fast-forwards local main so the branch we're
 * about to create includes all remote work. If the fetch fails (offline,
 * no remote), log a warning but continue — local main is still valid.
 * If local main has diverged from origin, hard-resets to origin/main and
 * triggers a self-restart to ensure clean process state.
 */
function ensureMainIsFresh(id) {
  try {
    execSync('git fetch origin main', { cwd: PROJECT_DIR, stdio: 'pipe', timeout: 15000 });
  } catch (err) {
    log('warn', 'git_safety', { id, msg: 'fetch origin/main failed — proceeding with local main', error: err.message });
    return;
  }

  const local  = execSync('git rev-parse main',        { cwd: PROJECT_DIR, encoding: 'utf-8' }).trim();
  const remote = execSync('git rev-parse origin/main', { cwd: PROJECT_DIR, encoding: 'utf-8' }).trim();

  if (local === remote) {
    log('info', 'git_safety', { id, msg: 'main is up to date with origin' });
    return;
  }

  // Check if local has commits not on origin (diverged)
  const ahead = execSync('git log origin/main..main --oneline', { cwd: PROJECT_DIR, encoding: 'utf-8' }).trim();

  if (ahead) {
    // Diverged — discard local-only commits and hard-reset to origin
    const aheadList = ahead.split('\n').map(l => l.trim()).filter(Boolean);
    log('warn', 'git_safety', {
      id,
      msg: `main has diverged from origin (${aheadList.length} local-only commit(s)) — hard-resetting to origin/main`,
      discarded: aheadList,
    });
    execSync('git reset --hard origin/main', { cwd: PROJECT_DIR, stdio: 'pipe' });
    const after = execSync('git rev-parse main', { cwd: PROJECT_DIR, encoding: 'utf-8' }).trim();
    log('info', 'git_safety', { id, msg: `Hard-reset complete: main now at ${after.slice(0, 8)}` });
    selfRestart(`main was diverged and has been hard-reset to origin/main at ${after.slice(0, 8)}`);
  } else {
    // Local is behind origin — safe fast-forward
    execSync('git merge --ff-only origin/main', { cwd: PROJECT_DIR, stdio: 'pipe' });
    const after = execSync('git rev-parse main', { cwd: PROJECT_DIR, encoding: 'utf-8' }).trim();
    log('info', 'git_safety', { id, msg: `Fast-forwarded main: ${local.slice(0, 8)} → ${after.slice(0, 8)}` });
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
    const stat = execSync(`git diff --stat main...${branchName}`, { cwd: PROJECT_DIR, encoding: 'utf-8' }).trim();
    // File list with status (A=added, M=modified, D=deleted)
    const nameStatus = execSync(`git diff --name-status main...${branchName}`, { cwd: PROJECT_DIR, encoding: 'utf-8' }).trim();

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
 * For amendments: checks out the existing branch.
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
    execSync(`git rev-parse --verify refs/heads/${branchName}`, { cwd: PROJECT_DIR, stdio: 'pipe' });
    branchExists = true;
  } catch (_) {}

  if (branchExists) {
    // Branch exists — check if it's already in another worktree and prune if needed
    try {
      const wtList = execSync('git worktree list --porcelain', { cwd: PROJECT_DIR, encoding: 'utf-8' });
      const blocks = wtList.split('\n\n').filter(Boolean);
      for (const block of blocks) {
        const lines = block.split('\n');
        const wtLine = lines.find(l => l.startsWith('worktree '));
        const brLine = lines.find(l => l.startsWith('branch '));
        if (wtLine && brLine && brLine === `branch refs/heads/${branchName}`) {
          const oldPath = wtLine.replace('worktree ', '');
          if (oldPath !== PROJECT_DIR) {
            try { fs.rmSync(oldPath, { recursive: true, force: true }); } catch (_) {}
            execSync('git worktree prune', { cwd: PROJECT_DIR, stdio: 'pipe' });
            log('info', 'worktree', { id, msg: `Pruned stale worktree at ${oldPath} for branch ${branchName}` });
          }
        }
      }
    } catch (_) {}

    // Existing branch (amendment or retry)
    execSync(`git worktree add "${wtPath}" ${branchName}`, { cwd: PROJECT_DIR, stdio: 'pipe' });
  } else {
    // New branch from main
    execSync(`git worktree add "${wtPath}" -b ${branchName} main`, { cwd: PROJECT_DIR, stdio: 'pipe' });
  }

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
    execSync('git worktree prune', { cwd: PROJECT_DIR, stdio: 'pipe' });
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

  log('info', 'worktree', { id, msg: `Cleaned up worktree for slice ${id}` });
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
          const wtList = execSync('git worktree list --porcelain', { cwd: PROJECT_DIR, encoding: 'utf-8' });
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
    const dirty = execSync('git diff --name-only HEAD', { cwd: PROJECT_DIR, encoding: 'utf-8' }).trim();
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
        const content = execSync(`git show HEAD:${file}`, { cwd: PROJECT_DIR, encoding: 'buffer' });
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
  // The watcher OWNS all branching. Rom never creates, checks out, or manages
  // branches. This is the rigid pipeline gate that prevents prompt-quality
  // failures from corrupting git state.
  //
  // New slices:  main → create slice/{id} branch → invoke Rom on that branch
  // Amendments:  checkout existing branch → invoke Rom on that branch
  // ──────────────────────────────────────────────────────────────────────────
  const sliceMeta = parseFrontmatter(sliceContent) || {};
  const isAmendment = !!(sliceMeta.amendment || (sliceMeta.references && sliceMeta.references !== 'null'));
  const sliceBranch = isAmendment
    ? (sliceMeta.amendment || sliceMeta.branch || `slice/${sliceMeta.root_commission_id || id}`)
    : `slice/${id}`;

  // ── WORKTREE-BASED BRANCH LIFECYCLE ──────────────────────────────────────
  // Each slice gets its own git worktree at /tmp/ds9-worktrees/{id}/.
  // PROJECT_DIR stays on main permanently. The dashboard is never affected.
  //
  // New slices:  create worktree with new branch from main
  // Amendments:  create worktree on existing branch (prunes old worktree if needed)
  // ──────────────────────────────────────────────────────────────────────────
  let worktreePath;
  try {
    ensureMainIsFresh(id);
    worktreePath = createWorktree(id, sliceBranch);
    log('info', 'branch', { id, msg: `Worktree ready at ${worktreePath} on branch ${sliceBranch}`, isAmendment });
  } catch (err) {
    const reason = isAmendment ? 'amendment_branch_checkout_failed' : 'branch_creation_failed';
    log('error', 'branch', { id, msg: `Failed to create worktree for ${sliceBranch} — aborting invocation`, error: err.message });
    const errorPath2 = path.join(QUEUE_DIR, `${id}-ERROR.md`);
    writeErrorFile(errorPath2, id, reason, err, '', '', {});
    log('info', 'state', { id, from: 'IN_PROGRESS', to: 'ERROR', reason });
    registerEvent(id, 'ERROR', { reason, error: err.message });
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
            registerEvent(id, 'ERROR', { reason: 'incomplete_metrics', invalid: metricsValid.invalid, durationMs });
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
            // --- Write Point 1: append timesheet row (Bet 3) ---
            const sliceMeta = parseFrontmatter(sliceContent) || {};
            const expectedHours = sliceMeta.expected_human_hours && sliceMeta.expected_human_hours !== 'null'
              ? parseFloat(sliceMeta.expected_human_hours)
              : null;
            const doneTokensIn  = parseInt(doneMeta.tokens_in, 10);
            const doneTokensOut = parseInt(doneMeta.tokens_out, 10);
            const timesheetCost = computeCost(doneTokensIn, doneTokensOut);

            // timesheet write point 1 — append watcher row at DONE
            appendTimesheet({
              ts: new Date(pickupTime).toISOString(),
              role: 'rom',
              source: 'watcher',
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
          // Rom exited 0 but wrote no DONE file — write an ERROR report with reason "no_report".
          log('warn', 'complete', {
            id,
            msg: "Rom exited cleanly but wrote no DONE file — writing ERROR (no_report)",
            reason: 'no_report',
            durationMs,
          });
          writeErrorFile(errorPath, id, 'no_report', null, stdout, stderr, { durationMs });
          log('info', 'state', { id, from: 'IN_PROGRESS', to: 'ERROR', reason: 'no_report' });
          registerEvent(id, 'ERROR', { reason: 'no_report', durationMs });
          appendKiraEvent({
            event: 'ERROR',
            slice_id: id,
            root_id: sliceMeta.root_commission_id || null,
            cycle: null,
            branch: sliceBranch || null,
            details: `Slice ${id} errored: no_report`,
          });
          // timesheet write point 2 — update watcher row at terminal state
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

        writeErrorFile(errorPath, id, reason, err, stdout, stderr, extra);
        log('info', 'state', { id, from: 'IN_PROGRESS', to: 'ERROR', reason });
        registerEvent(id, 'ERROR', { reason, exitCode: err.code, durationMs });
        appendKiraEvent({
          event: 'ERROR',
          slice_id: id,
          root_id: sliceMeta.root_commission_id || null,
          cycle: null,
          branch: sliceBranch || null,
          details: `Slice ${id} errored: ${reason}`,
        });
        // timesheet write point 2 — update watcher row at terminal state
        updateTimesheet(id, { result: 'ERROR', cycle: null, ts_result: new Date().toISOString() });
        closeSliceBlock(false, durationMs, tokensIn, tokensOut, costUsd, reasonDisplay);
        recordSessionResult(false, tokensIn, tokensOut, costUsd);
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
 * Reads register.jsonl and counts REVIEWED events for a given root slice ID.
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
 * for this slice ID — meaning it has already been evaluated.
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
 * Reads the SLICE and EVALUATING files for the given slice ID,
 * constructs an evaluator prompt, calls claude -p, parses the JSON verdict,
 * and handles ACCEPTED / AMENDMENT_NEEDED / STUCK outcomes.
 */
function invokeEvaluator(id) {
  const parkedPath  = path.join(QUEUE_DIR, `${id}-PARKED.md`);
  const legacyParkedPath  = path.join(QUEUE_DIR, `${id}-ARCHIVED.md`);
  const evaluatingPath  = path.join(QUEUE_DIR, `${id}-EVALUATING.md`);

  // Read PARKED file (original ACs). Fall back to legacy ARCHIVED for pre-145 slices.
  let sliceContent;
  const resolvedParkedPath = fs.existsSync(parkedPath) ? parkedPath : legacyParkedPath;
  try {
    sliceContent = fs.readFileSync(resolvedParkedPath, 'utf-8');
  } catch (err) {
    log('warn', 'evaluator', { id, msg: 'PARKED file not found — skipping evaluation', error: err.message });
    // Rename back to DONE so the poll loop can try again later.
    try { fs.renameSync(evaluatingPath, path.join(QUEUE_DIR, `${id}-DONE.md`)); } catch (_) {}
    processing = false;
    heartbeatState.status = 'idle';
    heartbeatState.current_slice = null;
    heartbeatState.current_slice_goal = null;
    heartbeatState.pickupTime = null;
    writeHeartbeat();
    return;
  }

  // Read EVALUATING file (Rom's DONE report).
  let evaluatingContent;
  try {
    evaluatingContent = fs.readFileSync(evaluatingPath, 'utf-8');
  } catch (err) {
    log('warn', 'evaluator', { id, msg: 'EVALUATING file not found — skipping evaluation', error: err.message });
    processing = false;
    heartbeatState.status = 'idle';
    heartbeatState.current_slice = null;
    heartbeatState.current_slice_goal = null;
    heartbeatState.pickupTime = null;
    writeHeartbeat();
    return;
  }

  // Extract branch name from Rom's DONE report frontmatter.
  const doneMeta = parseFrontmatter(evaluatingContent) || {};
  const branchName = doneMeta.branch || null;

  // Determine root slice ID and amendment cycle.
  const sliceMeta = parseFrontmatter(sliceContent) || {};
  const rootId = sliceMeta.root_commission_id || id;
  const cycle  = countReviewedCycles(rootId);

  log('info', 'evaluator', { id, rootId, cycle, branchName, msg: 'Starting evaluation' });
  print(`${B.tl}${B.sng.repeat(W - 1)}`);
  print(`${B.vert}  ${SYM.right} Evaluator${SYM.sep}Slice ${id} (${5 - cycle} retries remaining)`);
  print(`${B.vert}    Evaluating — fresh claude -p session, slice ACs + DONE report injected`);
  print(`${B.vert}`);

  // Build scope diff for Nog's review
  const scopeDiff = branchName ? buildScopeDiff(id, branchName, sliceContent) : '## SCOPE REVIEW — branch name unknown, scope diff unavailable\n';

  const prompt = [
    'You are Nog, Evaluator for Liberation of Bajor.',
    '',
    'Your job has THREE parts:',
    '',
    '### Part 1: Acceptance Criteria',
    'Did Rom\'s work satisfy ALL acceptance criteria in the original slice?',
    'Be specific. If even one AC is not met, the verdict is AMENDMENT_NEEDED.',
    '',
    '### Part 2: Intent Verification',
    'Every slice has a goal — a reason it exists. Read the slice\'s title and goal field.',
    'Then ask: does the shipped solution actually achieve that intent?',
    '',
    'It is possible to tick every AC checkbox while missing the point entirely.',
    'For example: a slice asks for "pagination so users can browse large result sets".',
    'Rom could add prev/next buttons that technically satisfy the AC "add pagination',
    'controls" but wire them to a hardcoded page 1 — the ACs pass, the intent fails.',
    '',
    'If the solution does not meaningfully achieve the slice\'s stated goal,',
    'even if individual ACs are technically met, that is AMENDMENT_NEEDED.',
    'Explain what the gap is between the intent and what was delivered.',
    '',
    '### Part 3: Scope Discipline',
    'Review the list of changed files below against the slice\'s title and goal.',
    'Ask yourself:',
    '- Did Rom ONLY change files that are relevant to this slice\'s goal?',
    '- Were any files modified that have nothing to do with the task?',
    '- If files outside the expected scope were touched, is there a clear reason',
    '  (e.g. a shared utility that needed updating, a config change required by the feature)?',
    '- Did any existing file lose significant content that was NOT related to the task?',
    '',
    'Out-of-scope changes are a red flag. If you see them and the DONE report does',
    'not explain why, that is an AMENDMENT_NEEDED — the fix instruction should be',
    '"revert changes to [file] that are outside the scope of this slice."',
    '',
    '## ORIGINAL SLICE (contains the acceptance criteria):',
    '',
    sliceContent,
    '',
    '## ROM\'S DONE REPORT:',
    '',
    evaluatingContent,
    '',
    scopeDiff,
    '',
    `## AMENDMENT CYCLE: ${cycle} of 5`,
    '',
    `## BRANCH: ${branchName || '(unknown — read from DONE report above)'}`,
    '',
    'Respond with ONLY valid JSON, no other text:',
    '{',
    '  "verdict": "ACCEPTED" or "AMENDMENT_NEEDED",',
    '  "reason": "One paragraph explaining your decision. Cover all three parts: ACs, intent, and scope.",',
    '  "failed_criteria": ["list of specific ACs not met, empty if all pass"],',
    '  "intent_met": true or false,',
    '  "intent_gap": "If intent_met is false: what the slice intended vs what was actually delivered. If true: empty string.",',
    '  "out_of_scope": ["list of files changed outside the slice\'s scope, empty if clean"],',
    '  "amendment_instructions": "If AMENDMENT_NEEDED: specific instructions for Rom. Cover failed ACs, intent gaps, and out-of-scope reversions. Reference file paths. If ACCEPTED: empty string."',
    '}',
  ].join('\n');

  const pickupTime = Date.now();

  // ── Resolve worktree for Nog ──────────────────────────────────────────
  // Nog needs to see the feature branch's code, not main.
  // Try the original slice's worktree first, then recreate if needed.
  let evalWorktreePath = getWorktreePath(id);
  if (!fs.existsSync(evalWorktreePath) && branchName) {
    // Worktree was cleaned up — recreate from the slice branch
    try {
      evalWorktreePath = createWorktree(id, branchName);
      log('info', 'evaluator', { id, msg: `Recreated worktree for evaluation at ${evalWorktreePath}` });
    } catch (wtErr) {
      log('warn', 'evaluator', { id, msg: 'Could not create worktree for evaluation — falling back to PROJECT_DIR', error: wtErr.message });
      evalWorktreePath = PROJECT_DIR;
    }
  } else if (!fs.existsSync(evalWorktreePath)) {
    evalWorktreePath = PROJECT_DIR;
  }
  // ──────────────────────────────────────────────────────────────────────

  // Write nog-active.json so the dashboard can show Nog's live state.
  try {
    fs.writeFileSync(NOG_ACTIVE_FILE, JSON.stringify({
      sliceId: String(id),
      title: sliceMeta.title || null,
      round: cycle + 1,
      invokedAt: new Date().toISOString(),
    }), 'utf8');
  } catch (_) {}

  // Progress tick every 60s.
  const tickInterval = setInterval(() => {
    printProgressTick(Date.now() - pickupTime);
  }, 60000);

  const child = execFile(
    config.claudeCommand,
    config.claudeArgs,
    {
      cwd: evalWorktreePath,
      encoding: 'utf-8',
      timeout: config.timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    },
    (err, stdout, stderr) => {
      clearInterval(tickInterval);
      // Clean up nog-active.json — Nog is done.
      try { fs.renameSync(NOG_ACTIVE_FILE, path.join(TRASH_DIR, 'nog-active.json.done')); } catch (_) {}
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
        heartbeatState.current_slice = null;
        heartbeatState.current_slice_goal = null;
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
        handleAmendment(id, rootId, reason, failedCriteria, amendmentInstructions, cycle, branchName, evaluatingPath, sliceContent, durationMs);
      } else {
        handleStuck(id, reason, cycle, branchName, evaluatingPath, durationMs);
      }

      // Reset processing state.
      processing = false;
      heartbeatState.status = 'idle';
      heartbeatState.current_slice = null;
      heartbeatState.current_slice_goal = null;
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
 * Worktree-based FUSE-safe merge:
 *   1. In the worktree: merge main into slice branch (runs on local FS, not FUSE)
 *   2. In PROJECT_DIR: update-ref to fast-forward main to the merge result
 *   3. Sync changed files from worktree to PROJECT_DIR via fs.copyFileSync
 *   4. Update index with git read-tree
 *   5. Post-merge verification + push
 *
 * Returns { success, sha, error } where sha is the merge commit hash on success.
 */
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
    const oldMain = execSync('git rev-parse main', { cwd: PROJECT_DIR, encoding: 'utf-8' }).trim();
    execSync(`git merge main -m "${commitMsg.replace(/"/g, '\\"')}"`, { cwd: wtPath, stdio: 'pipe' });

    // ── Step 2: Fast-forward main to the merge result ──────────────────
    const newSha = execSync(`git rev-parse ${branchName}`, { cwd: PROJECT_DIR, encoding: 'utf-8' }).trim();
    execSync(`git update-ref refs/heads/main ${newSha}`, { cwd: PROJECT_DIR, stdio: 'pipe' });

    // ── Step 3: Sync changed files from worktree to PROJECT_DIR ────────
    // FUSE handles writes fine (writeFileSync truncates in-place).
    const diffRaw = execSync(`git diff --name-only ${oldMain} main`, { cwd: PROJECT_DIR, encoding: 'utf-8' }).trim();
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
    execSync('git read-tree main', { cwd: PROJECT_DIR, stdio: 'pipe' });

    // ── Post-merge verification ─────────────────────────────────────────
    // Safety net: ensure disk matches committed state.
    verifyWorkingTreeMatchesMain(id, 'merge');

    try {
      execSync('git push origin main', { cwd: PROJECT_DIR, stdio: 'pipe' });
    } catch (pushErr) {
      // Push failure is non-fatal — the merge succeeded locally.
      log('warn', 'merge', { id, msg: 'git push origin main failed (merge succeeded locally)', error: pushErr.message });
    }
    return { success: true, sha: newSha, error: null };
  } catch (err) {
    // Abort any in-progress merge in the worktree to leave git in a clean state.
    try { execSync('git merge --abort', { cwd: wtPath, stdio: 'pipe' }); } catch (_) {}
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

  registerEvent(id, 'ACCEPTED', { reason, cycle });
  log('info', 'evaluator', { id, verdict: 'ACCEPTED', cycle, durationMs });

  // timesheet write point 2 — update watcher row at terminal state
  updateTimesheet(id, { result: 'ACCEPTED', cycle, ts_result: new Date().toISOString() });

  const acceptedPath = path.join(QUEUE_DIR, `${id}-ACCEPTED.md`);
  try {
    fs.renameSync(evaluatingPath, acceptedPath);
    log('info', 'state', { id, from: 'EVALUATING', to: 'ACCEPTED' });
  } catch (err) {
    log('warn', 'evaluator', { id, msg: 'Failed to rename EVALUATING to ACCEPTED', error: err.message });
  }

  callReviewAPI(id, 'ACCEPTED', reason);

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

/**
 * handleAmendment(id, rootId, reason, failedCriteria, amendmentInstructions,
 *                 cycle, branchName, evaluatingPath, sliceContent, durationMs)
 *
 * AMENDMENT_NEEDED verdict: register event, rename EVALUATING → IN_REVIEW, write amendment QUEUED.
 */
function handleAmendment(id, rootId, reason, failedCriteria, amendmentInstructions, cycle, branchName, evaluatingPath, sliceContent, durationMs) {
  registerEvent(id, 'REVIEWED', { verdict: 'AMENDMENT_NEEDED', reason, failed_criteria: failedCriteria, cycle: cycle + 1, root_commission_id: rootId });
  log('info', 'evaluator', { id, verdict: 'AMENDMENT_NEEDED', cycle: cycle + 1, rootId, durationMs });

  const inReviewPath = path.join(QUEUE_DIR, `${id}-IN_REVIEW.md`);
  try {
    fs.renameSync(evaluatingPath, inReviewPath);
    log('info', 'state', { id, from: 'EVALUATING', to: 'IN_REVIEW' });
  } catch (err) {
    log('warn', 'evaluator', { id, msg: 'Failed to rename EVALUATING to IN_REVIEW', error: err.message });
  }

  // Write amendment slice QUEUED.
  const nextId = nextSliceId(QUEUE_DIR);
  const failedList = (failedCriteria || []).map((c, i) => `${i + 1}. ${c}`).join('\n');
  const amendmentContent = [
    '---',
    `id: "${nextId}"`,
    `title: "Amendment ${cycle + 1} — fix failed criteria for slice ${rootId}"`,
    `goal: "All acceptance criteria from slice ${rootId} are met on branch ${branchName || '(original branch)'}."`,
    'from: nog',
    'to: rom',
    'priority: normal',
    `created: "${new Date().toISOString()}"`,
    `amendment: "${branchName || ''}"`,
    'timeout_min: null',
    'type: amendment',
    `root_commission_id: "${rootId}"`,
    `amendment_cycle: ${cycle + 1}`,
    `branch: "${branchName || ''}"`,
    '---',
    '',
    '## Objective',
    '',
    `This is an amendment to slice ${rootId} (cycle ${cycle + 1} of 5).`,
    '',
    '**IMPORTANT: The watcher handles all git branching. Do NOT run any git checkout, git branch, or git switch commands. You are already on the correct branch. Just make your changes and commit.**',
    '',
    '## Failed criteria',
    '',
    failedList || '(see amendment instructions below)',
    '',
    '## Amendment instructions',
    '',
    amendmentInstructions || '(see failed criteria above)',
    '',
    '## Original acceptance criteria (from slice ' + rootId + ')',
    '',
    sliceContent,
    '',
    '## Constraints',
    '',
    '- Do NOT create, checkout, or switch branches. The watcher manages the branch lifecycle.',
    '- Commit your changes to the current branch only.',
    '',
    '## Success criteria',
    '',
    '1. All failed criteria listed above are resolved.',
    '2. All original acceptance criteria from slice ' + rootId + ' are met.',
    '3. DONE report includes branch name in frontmatter.',
  ].join('\n');

  const amendmentQueuedPath = path.join(QUEUE_DIR, `${nextId}-QUEUED.md`);
  try {
    fs.writeFileSync(amendmentQueuedPath, amendmentContent);
    log('info', 'evaluator', { id, msg: `Wrote amendment slice ${nextId}-QUEUED.md`, nextId, cycle: cycle + 1, rootId });
  } catch (err) {
    log('warn', 'evaluator', { id, msg: 'Failed to write amendment slice QUEUED', error: err.message });
  }

  callReviewAPI(id, 'AMENDMENT_NEEDED', reason);

  print(`${B.vert}    ${C.yellow}${SYM.cross}${C.reset} AMENDMENT_NEEDED (cycle ${cycle + 1})${SYM.sep}Amendment ${nextId} queued`);
  print(`${B.bl}${B.sng.repeat(W - 1)}`);
  print('');
}

/**
 * handleStuck(id, reason, cycle, branchName, evaluatingPath, durationMs)
 *
 * STUCK verdict: register event, rename EVALUATING → STUCK, no new QUEUED.
 */
function handleStuck(id, reason, cycle, branchName, evaluatingPath, durationMs) {
  registerEvent(id, 'STUCK', { reason: 'amendment cap reached', cycle, branch: branchName });
  log('warn', 'evaluator', { id, verdict: 'STUCK', cycle, durationMs });

  // timesheet write point 2 — update watcher row at terminal state
  updateTimesheet(id, { result: 'STUCK', cycle, ts_result: new Date().toISOString() });

  const stuckPath = path.join(QUEUE_DIR, `${id}-STUCK.md`);
  try {
    fs.renameSync(evaluatingPath, stuckPath);
    log('info', 'state', { id, from: 'EVALUATING', to: 'STUCK' });
  } catch (err) {
    log('warn', 'evaluator', { id, msg: 'Failed to rename EVALUATING to STUCK', error: err.message });
  }

  callReviewAPI(id, 'STUCK', reason);

  appendKiraEvent({
    event: 'STUCK',
    slice_id: id,
    root_id: null,
    cycle: cycle || null,
    branch: branchName || null,
    details: `Slice ${id} stuck after ${cycle} cycles`,
  });

  // Clean up the worktree — STUCK is a terminal state (5th rejection / back to O'Brien)
  try { cleanupWorktree(id, branchName); } catch (_) {}

  print(`${B.vert}    ${C.red}${SYM.cross}${C.reset} STUCK${SYM.sep}Slice ${id} hit amendment cap (${cycle} cycles). Manual intervention required.`);
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
 * RETURN → create amendment and re-queue for O'Brien.
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

    registerEvent(id, 'NOG_ESCALATION', { round, branch: branchName });

    // Rename to STUCK.
    const stuckPath = path.join(QUEUE_DIR, `${id}-STUCK.md`);
    try {
      fs.renameSync(donePath, stuckPath);
      log('info', 'state', { id, from: 'EVALUATING', to: 'STUCK' });
    } catch (err) {
      log('warn', 'nog', { id, msg: 'Failed to rename to STUCK', error: err.message });
    }

    updateTimesheet(id, { result: 'STUCK', cycle: round, ts_result: new Date().toISOString() });

    print(`${B.vert}    ${C.red}${SYM.cross}${C.reset} NOG ESCALATION${SYM.sep}Slice ${id} failed 5 Nog rounds — escalated to Kira`);
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
      gitDiff = execSync(`git diff main...${branchName}`, { cwd: PROJECT_DIR, encoding: 'utf-8', maxBuffer: 5 * 1024 * 1024 });
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

  // Build prompt.
  const prompt = buildNogPrompt({
    id,
    round,
    sliceFileContents: sliceContent,
    doneReportContents,
    gitDiff,
    slicePath: archivedPath,
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
            verdict = nogMeta.verdict ? nogMeta.verdict.toUpperCase() : null;
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

      if (!verdict || !['PASS', 'RETURN'].includes(verdict)) {
        // Missing or unparseable verdict — treat as RETURN.
        log('warn', 'nog', { id, msg: 'Nog verdict unreadable — treating as RETURN', verdict, durationMs });

        registerEvent(id, 'NOG_RETURN', { round, reason: 'verdict_unreadable' });
        appendKiraEvent({
          event: 'NOG_ESCALATION',
          slice_id: id,
          root_id: rootId !== id ? rootId : null,
          cycle: round,
          branch: branchName || null,
          details: `Nog verdict unreadable for slice ${id} round ${round}`,
        });

        // Create amendment for O'Brien with error details.
        handleNogReturn(id, rootId, round, branchName, donePath, sliceContent, 'Nog verdict unreadable — manual review required', durationMs);

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

      if (verdict === 'PASS') {
        log('info', 'nog', { id, verdict: 'PASS', round, durationMs, summary });
        registerEvent(id, 'NOG_PASS', { round });

        // Rename EVALUATING back to DONE so the existing evaluator picks it up.
        try {
          fs.renameSync(donePath, path.join(QUEUE_DIR, `${id}-DONE.md`));
          log('info', 'state', { id, from: 'EVALUATING', to: 'DONE', reason: 'nog_pass' });
        } catch (renameErr) {
          log('warn', 'nog', { id, msg: 'Failed to rename back to DONE after PASS', error: renameErr.message });
        }

        // Clean up NOG.md verdict file.
        try { fs.renameSync(nogVerdictPath, path.join(TRASH_DIR, `${id}-NOG.md.pass`)); } catch (_) {}

        print(`${B.vert}    ${C.green}${SYM.check}${C.reset} Nog PASS${SYM.sep}Round ${round}${summary ? SYM.dash + summary : ''}`);
        print(`${B.vert}    Proceeding to evaluator`);
        print(`${B.bl}${B.sng.repeat(W - 1)}`);
        print('');

        // Now invoke the existing evaluator.
        // Re-claim the DONE file — the evaluator expects to rename DONE → EVALUATING.
        // We'll let the next poll cycle pick it up naturally.
        processing = false;
        heartbeatState.status = 'idle';
        heartbeatState.current_slice = null;
        heartbeatState.current_slice_goal = null;
        heartbeatState.pickupTime = null;
        heartbeatState.processed_total += 1;
        writeHeartbeat();
        return;
      }

      // RETURN verdict.
      log('info', 'nog', { id, verdict: 'RETURN', round, durationMs, summary });
      registerEvent(id, 'NOG_RETURN', { round });

      handleNogReturn(id, rootId, round, branchName, donePath, sliceContent, summary || 'Nog review findings — see slice file', durationMs);

      // Clean up NOG.md verdict file.
      try { fs.renameSync(nogVerdictPath, path.join(TRASH_DIR, `${id}-NOG.md.return`)); } catch (_) {}

      print(`${B.vert}    ${C.yellow}${SYM.cross}${C.reset} Nog RETURN${SYM.sep}Round ${round}${summary ? SYM.dash + summary : ''}`);
      print(`${B.vert}    Amendment queued for O'Brien`);
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
 * RETURN verdict from Nog: create amendment slice for O'Brien.
 */
function handleNogReturn(id, rootId, round, branchName, evaluatingPath, sliceContent, summary, durationMs) {
  const inReviewPath = path.join(QUEUE_DIR, `${id}-IN_REVIEW.md`);
  try {
    fs.renameSync(evaluatingPath, inReviewPath);
    log('info', 'state', { id, from: 'EVALUATING', to: 'IN_REVIEW', reason: 'nog_return' });
  } catch (err) {
    log('warn', 'nog', { id, msg: 'Failed to rename EVALUATING to IN_REVIEW', error: err.message });
  }

  // Write amendment slice QUEUED.
  const nextId = nextSliceId(QUEUE_DIR);
  const amendmentContent = [
    '---',
    `id: "${nextId}"`,
    `title: "Nog return round ${round} — fix findings for slice ${rootId}"`,
    `goal: "Address Nog code review findings from round ${round} for slice ${rootId}."`,
    'from: nog',
    'to: rom',
    'priority: normal',
    `created: "${new Date().toISOString()}"`,
    `amendment: "${branchName || ''}"`,
    'timeout_min: null',
    'type: amendment',
    `root_commission_id: "${rootId}"`,
    `amendment_cycle: ${round}`,
    `branch: "${branchName || ''}"`,
    `round: ${round}`,
    'status: QUEUED',
    '---',
    '',
    '## Objective',
    '',
    `This is a Nog code review return for slice ${rootId} (round ${round} of 5).`,
    '',
    '**IMPORTANT: The watcher handles all git branching. Do NOT run any git checkout, git branch, or git switch commands. You are already on the correct branch. Just make your changes and commit.**',
    '',
    '## Nog review summary',
    '',
    summary,
    '',
    '## Instructions',
    '',
    'Read the Nog review section appended to the slice file for detailed findings.',
    'Fix all issues identified by Nog, then write your DONE report.',
    '',
    '## Original slice (with Nog review history)',
    '',
    sliceContent,
    '',
    '## Constraints',
    '',
    '- Do NOT create, checkout, or switch branches. The watcher manages the branch lifecycle.',
    '- Commit your changes to the current branch only.',
    '',
    '## Success criteria',
    '',
    '1. All Nog findings from the latest round are addressed.',
    `2. All original acceptance criteria from slice ${rootId} are met.`,
    '3. DONE report includes branch name in frontmatter.',
  ].join('\n');

  const amendmentQueuedPath = path.join(QUEUE_DIR, `${nextId}-QUEUED.md`);
  try {
    fs.writeFileSync(amendmentQueuedPath, amendmentContent);
    log('info', 'nog', { id, msg: `Wrote Nog amendment slice ${nextId}-QUEUED.md`, nextId, round, rootId });
  } catch (err) {
    log('warn', 'nog', { id, msg: 'Failed to write Nog amendment slice QUEUED', error: err.message });
  }
}

/**
 * hasNogReviewEvent(id)
 *
 * Returns true if register.jsonl contains a NOG_PASS or NOG_ESCALATION event
 * for this slice ID — meaning Nog has already reviewed it.
 */
function hasNogReviewEvent(id) {
  try {
    const lines = fs.readFileSync(REGISTER_FILE, 'utf-8').trim().split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.id === String(id) && ['NOG_PASS', 'NOG_ESCALATION'].includes(entry.event)) {
          return true;
        }
      } catch (_) {}
    }
  } catch (_) {}
  return false;
}

// ---------------------------------------------------------------------------
// ERROR file (written by watcher on invocation failure or invalid slice)
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
    'from: watcher',
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
    // Must never crash the watcher
  }
}

// ---------------------------------------------------------------------------
// Poll cycle
// ---------------------------------------------------------------------------

function poll() {
  if (processing) return;

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
      // Priority sorting: amendments (rejections) jump the queue.
      // Read frontmatter to check for amendment_cycle or references field.
      const isAmendmentA = (() => {
        try {
          const content = fs.readFileSync(path.join(QUEUE_DIR, a), 'utf-8');
          const meta = parseFrontmatter(content);
          return meta && (meta.type === 'amendment' || !!meta.amendment || (meta.references && meta.references !== 'null'));
        } catch (_) { return false; }
      })();
      const isAmendmentB = (() => {
        try {
          const content = fs.readFileSync(path.join(QUEUE_DIR, b), 'utf-8');
          const meta = parseFrontmatter(content);
          return meta && (meta.type === 'amendment' || !!meta.amendment || (meta.references && meta.references !== 'null'));
        } catch (_) { return false; }
      })();
      // Amendments sort before fresh slices
      if (isAmendmentA && !isAmendmentB) return -1;
      if (!isAmendmentA && isAmendmentB) return 1;
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
      registerEvent(doneId, 'ACCEPTED', { reason: 'auto-accepted merge', cycle: 0 });
      callReviewAPI(doneId, 'ACCEPTED', 'auto-accepted merge');
      print(`  ${C.green}${SYM.check}${C.reset} Slice ${doneId}${SYM.dash}Merge auto-accepted`);
      continue;
    }

    // Skip if already reviewed (evaluator has run).
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

    // Route: Nog code review first, then evaluator.
    // If Nog has already passed this slice, go straight to evaluator.
    if (hasNogReviewEvent(doneId)) {
      heartbeatState.status = 'evaluating';
      writeHeartbeat();
      invokeEvaluator(doneId);
    } else {
      heartbeatState.status = 'nog_review';
      writeHeartbeat();
      invokeNog(doneId);
    }
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
  const REQUIRED_FIELDS = ['id', 'title', 'from', 'to', 'priority', 'created'];
  const missingFields = REQUIRED_FIELDS.filter(
    field => !meta || !meta[field] || meta[field].trim() === ''
  );

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
    registerEvent(errId, 'ERROR', { reason: 'invalid_slice', missingFields });
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
 * Exported so the watcher can call it from bridge/next-id.js.
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

  // Clean up .dead worktree/branch entries from prior sessions.
  cleanupDeadWorktrees();

  const recoveryActions = crashRecovery();
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
// Exports — for use by helper scripts (e.g. bridge/next-id.js)
// ---------------------------------------------------------------------------

module.exports = { nextSliceId, getQueueSnapshot };
