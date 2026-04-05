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
  claudeArgs: ['-p', '--permission-mode', 'bypassPermissions'],
  projectDir: '..',
  maxRetries: 0,
};

function loadConfig() {
  const configPath = path.join(__dirname, 'bridge.config.json');
  let fileConfig = {};
  try {
    fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch (err) {
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
// Structured logging
// ---------------------------------------------------------------------------

/**
 * log(level, event, fields)
 *
 * Writes one JSON line to bridge.log AND mirrors to stdout.
 * Each line: { ts, level, event, ...fields }
 */
function log(level, event, fields) {
  const line = JSON.stringify(Object.assign({ ts: new Date().toISOString(), level, event }, fields));
  try {
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch (err) {
    // Log file write failure must not crash the watcher.
    process.stdout.write('[log-write-error] ' + err.message + '\n');
  }
  process.stdout.write(line + '\n');
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
 * On success: checks donePath exists; if not, writes a fallback DONE report.
 * On failure: writes an ERROR report and removes the IN_PROGRESS file.
 * Always removes the IN_PROGRESS file on completion.
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
      const durationMs = Date.now() - pickupTime;
      const isTimeout = err && err.killed && err.signal === 'SIGTERM';

      if (!err) {
        // Success path: check Rook wrote his DONE file.
        if (fs.existsSync(donePath)) {
          log('info', 'complete', { id, msg: 'Rook finished — DONE file present', durationMs });
          log('info', 'state', { id, from: 'IN_PROGRESS', to: 'DONE' });
        } else {
          // Fallback: Rook exited zero but wrote no DONE file.
          log('warn', 'complete', {
            id,
            msg: 'Rook exited cleanly but wrote no DONE file — writing fallback',
            durationMs,
          });
          writeFallbackDone(donePath, id, stdout);
          log('info', 'state', { id, from: 'IN_PROGRESS', to: 'DONE', fallback: true });
        }
      } else {
        // Failure path: invocation failure → ERROR file (watcher writes it).
        const reason = isTimeout ? 'timeout' : 'invocation-failure';
        log('error', isTimeout ? 'timeout' : 'error', {
          id,
          msg: isTimeout ? 'Commission timed out' : 'claude -p failed',
          exitCode: err.code,
          signal: err.signal || null,
          durationMs,
        });
        writeErrorFile(errorPath, id, reason, err, stdout, stderr);
        log('info', 'state', { id, from: 'IN_PROGRESS', to: 'ERROR' });
      }

      // Clean up IN_PROGRESS file.
      try {
        fs.unlinkSync(inProgressPath);
      } catch (unlinkErr) {
        log('warn', 'error', { id, msg: 'Failed to delete IN_PROGRESS file', error: unlinkErr.message });
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
// Fallback DONE report (written by watcher when Rook exits 0 but writes nothing)
// ---------------------------------------------------------------------------

function writeFallbackDone(donePath, id, stdout) {
  const completed = new Date().toISOString();
  const content = [
    '---',
    `id: "${id}"`,
    `title: "Commission ${id} (fallback report)"`,
    'from: watcher',
    'to: mara',
    'status: PARTIAL',
    `commission_id: "${id}"`,
    `completed: "${completed}"`,
    '---',
    '',
    '## What I did',
    '',
    'Rook exited cleanly (exit code 0) but did not write a DONE file.',
    'This report was generated by the watcher as a fallback.',
    '',
    '## What succeeded',
    '',
    'Unknown — Rook produced no structured report.',
    '',
    '## What failed',
    '',
    'No DONE file written by Rook.',
    '',
    '## Blockers / Questions for Mara',
    '',
    'Investigate why Rook exited without writing a report.',
    '',
    '## Files changed',
    '',
    'Unknown.',
    '',
    '## Rook stdout (raw)',
    '',
    '```',
    stdout || '(empty)',
    '```',
  ].join('\n');

  try {
    fs.writeFileSync(donePath, content);
  } catch (err) {
    log('error', 'error', { id, msg: 'Failed to write fallback DONE file', error: err.message });
  }
}

// ---------------------------------------------------------------------------
// ERROR file (written by watcher on invocation failure)
// ---------------------------------------------------------------------------

function writeErrorFile(errorPath, id, reason, err, stdout, stderr) {
  const completed = new Date().toISOString();
  const exitCode = err.code != null ? String(err.code) : 'null';
  const signal = err.signal || 'null';

  const content = [
    '---',
    `id: "${id}"`,
    `title: "Commission ${id} invocation failure"`,
    'from: watcher',
    'to: mara',
    'status: ERROR',
    `commission_id: "${id}"`,
    `completed: "${completed}"`,
    '---',
    '',
    '## Failure reason',
    '',
    `**${reason}**`,
    '',
    reason === 'timeout'
      ? `The \`claude -p\` process was killed after exceeding the configured timeout.`
      : `The \`claude -p\` process exited with a non-zero status.`,
    '',
    '## Invocation details',
    '',
    `- Exit code: ${exitCode}`,
    `- Signal: ${signal}`,
    `- Reason: ${reason}`,
    '',
    '## stderr',
    '',
    '```',
    stderr || '(empty)',
    '```',
    '',
    '## stdout',
    '',
    '```',
    stdout || '(empty)',
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

  // Parse frontmatter for timeout_min override.
  const meta = parseFrontmatter(commissionContent);
  const timeoutMin = meta && meta.timeout_min && meta.timeout_min !== 'null'
    ? parseInt(meta.timeout_min, 10)
    : null;
  const effectiveTimeoutMs = timeoutMin != null && !isNaN(timeoutMin)
    ? timeoutMin * 60 * 1000
    : config.timeoutMs;

  // Derive sibling paths.
  const inProgressPath = path.join(QUEUE_DIR, `${id}-IN_PROGRESS.md`);
  const donePath       = path.join(QUEUE_DIR, `${id}-DONE.md`);
  const errorPath      = path.join(QUEUE_DIR, `${id}-ERROR.md`);

  // Atomic rename: PENDING → IN_PROGRESS.
  try {
    fs.renameSync(pendingPath, inProgressPath);
  } catch (err) {
    log('error', 'error', { id, msg: 'Failed to rename PENDING to IN_PROGRESS', error: err.message });
    return;
  }

  log('info', 'pickup', { id, msg: 'Commission picked up', file: pendingFile });
  log('info', 'state', { id, from: 'PENDING', to: 'IN_PROGRESS' });

  processing = true;

  // Invoke Rook asynchronously — event loop stays live.
  invokeRook(commissionContent, donePath, inProgressPath, errorPath, id, effectiveTimeoutMs);
}

// ---------------------------------------------------------------------------
// Crash recovery stub
// ---------------------------------------------------------------------------

function crashRecovery() {
  // TODO (Layer 3, capability 3.1): Scan QUEUE_DIR for orphaned IN_PROGRESS files
  // on startup and resolve them:
  //   - {id}-IN_PROGRESS.md alone          → rename back to {id}-PENDING.md (re-queue)
  //   - {id}-IN_PROGRESS.md + DONE present  → delete IN_PROGRESS (already complete)
  //   - {id}-IN_PROGRESS.md + ERROR present → delete IN_PROGRESS (already failed)
  // See docs/contracts/queue-lifecycle.md §"Crash recovery" and
  // Architecture — Bridge of Hormuz v1.md §4 for full spec.
  log('info', 'startup', { msg: 'Crash recovery: stub (Layer 3, not implemented)' });
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
  }
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

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

crashRecovery();

// Initial heartbeat write so the file exists immediately on startup.
writeHeartbeat();

// Start heartbeat interval.
setInterval(writeHeartbeat, config.heartbeatIntervalMs);

// Start poll interval + immediate first poll.
setInterval(poll, config.pollIntervalMs);
poll();
