'use strict';

/**
 * git-finalizer.js — Slice 184
 *
 * Centralises all git shell-outs behind a try/finally wrapper that:
 *   1. Emits LOCK_CLAIMED / LOCK_RELEASED register events.
 *   2. On exception: checks for orphan .git/index.lock and prunes it.
 *   3. For worktree ops: cleans up half-created worktree dirs on failure.
 *
 * Also provides sweepStaleResources() for cycle-start cleanup and
 * createWorktreeWithRetry() for transient index-lock contention.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

let WORKTREE_BASE = '/tmp/ds9-worktrees';
let WORKTREE_BASE_PRIVATE = '/private/tmp/ds9-worktrees';

// Path guard: rm -rf MUST only target dirs under the worktree base.
function assertWorktreePath(p) {
  const resolved = path.resolve(p);
  if (!resolved.startsWith(WORKTREE_BASE + '/') && !resolved.startsWith(WORKTREE_BASE_PRIVATE + '/')) {
    throw new Error(`SAFETY: refusing to remove path outside worktree base: ${resolved}`);
  }
}

// ---------------------------------------------------------------------------
// Dependency injection — set by init()
// ---------------------------------------------------------------------------

let PROJECT_DIR = null;
let registerEvent = null;
let log = null;
let HEARTBEAT_FILE = null;
let QUEUE_DIR = null;

/**
 * init(deps)
 *
 * Must be called once at startup with orchestrator dependencies.
 */
function init(deps) {
  PROJECT_DIR = deps.PROJECT_DIR;
  registerEvent = deps.registerEvent;
  log = deps.log;
  HEARTBEAT_FILE = deps.HEARTBEAT_FILE;
  QUEUE_DIR = deps.QUEUE_DIR;
  // Allow tests to override worktree base for isolation
  if (deps.WORKTREE_BASE) {
    WORKTREE_BASE = deps.WORKTREE_BASE;
    WORKTREE_BASE_PRIVATE = deps.WORKTREE_BASE;
  }
}

// ---------------------------------------------------------------------------
// Lock helpers
// ---------------------------------------------------------------------------

function indexLockPath() {
  return path.join(PROJECT_DIR, '.git', 'index.lock');
}

function lockExists() {
  return fs.existsSync(indexLockPath());
}

/**
 * isGitProcessAlive()
 *
 * Returns true if a live git process holds .git/index.lock.
 * Uses lsof as a quick heuristic — if lsof fails or finds nothing,
 * the lock is considered orphaned.
 */
function isGitProcessAlive() {
  try {
    const { execFileSync } = require('child_process');
    const out = execFileSync('lsof', [indexLockPath()], { encoding: 'utf-8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'] });
    return out.trim().length > 0;
  } catch (_) {
    return false;
  }
}

/**
 * pruneOrphanLock(sliceId, op)
 *
 * If .git/index.lock exists and no git process holds it, remove it.
 * Returns true if pruned.
 */
function pruneOrphanLock(sliceId, op) {
  if (!lockExists()) return false;
  if (isGitProcessAlive()) {
    log('warn', 'git_finalizer', { slice_id: sliceId, op, msg: 'index.lock exists and a git process is alive — leaving lock' });
    return false;
  }
  try {
    const stat = fs.statSync(indexLockPath());
    fs.unlinkSync(indexLockPath());
    registerEvent(sliceId || '0', 'LOCK_ORPHAN_PRUNED', {
      op,
      artifact: indexLockPath(),
      lock_mtime: stat.mtime.toISOString(),
      lock_age_s: Math.round((Date.now() - stat.mtimeMs) / 1000),
    });
    log('info', 'git_finalizer', { slice_id: sliceId, op, msg: 'Pruned orphan .git/index.lock' });
    return true;
  } catch (err) {
    log('warn', 'git_finalizer', { slice_id: sliceId, op, msg: 'Failed to prune orphan lock', error: err.message });
    return false;
  }
}

// ---------------------------------------------------------------------------
// Refs-lock helpers — extends self-heal to .git/refs/heads/**/*.lock
// and .git/packed-refs.lock (slice 219)
// ---------------------------------------------------------------------------

/** Minimum age in seconds before a refs lock is eligible for pruning. */
const MIN_LOCK_AGE_SECONDS = 30;

/**
 * isLockHeldByProcess(lockPath)
 *
 * Returns true if a live process holds the given lock file.
 * Generalised version of isGitProcessAlive() that accepts any path.
 */
function isLockHeldByProcess(lockPath) {
  try {
    const { execFileSync } = require('child_process');
    const out = execFileSync('lsof', [lockPath], { encoding: 'utf-8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'] });
    return out.trim().length > 0;
  } catch (_) {
    return false;
  }
}

/**
 * findOrphanRefsLocks()
 *
 * Walks .git/refs/heads/ recursively for *.lock files.
 * Also checks .git/packed-refs.lock.
 * Returns array of absolute paths.
 */
function findOrphanRefsLocks() {
  const locks = [];
  const refsHeadsDir = path.join(PROJECT_DIR, '.git', 'refs', 'heads');
  const packedRefsLock = path.join(PROJECT_DIR, '.git', 'packed-refs.lock');

  // Recursive walk of .git/refs/heads/
  function walkDir(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkDir(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.lock')) {
        locks.push(fullPath);
      }
    }
  }

  walkDir(refsHeadsDir);

  // Check packed-refs.lock
  if (fs.existsSync(packedRefsLock)) {
    locks.push(packedRefsLock);
  }

  return locks;
}

/**
 * pruneOrphanRefsLocks(diagnostics)
 *
 * For each refs lock found by findOrphanRefsLocks():
 *   - If held by a live process → emit REFS_LOCK_DETECTED (decline_reason: process_alive)
 *   - If younger than MIN_LOCK_AGE_SECONDS → emit REFS_LOCK_DETECTED (decline_reason: too_young)
 *   - Otherwise → prune and emit REFS_LOCK_ORPHAN_PRUNED
 *
 * Returns { pruned: number, skipped: number }
 */
function pruneOrphanRefsLocks(diagnostics) {
  const locks = findOrphanRefsLocks();
  let pruned = 0;
  let skipped = 0;

  for (const lockPath of locks) {
    let stat;
    try {
      stat = fs.statSync(lockPath);
    } catch (_) {
      continue; // Lock vanished between find and stat
    }

    const lockAgeS = Math.round((Date.now() - stat.mtimeMs) / 1000);

    if (isLockHeldByProcess(lockPath)) {
      skipped++;
      registerEvent('0', 'REFS_LOCK_DETECTED', {
        lock_path: lockPath,
        lock_age_s: lockAgeS,
        decline_reason: 'process_alive',
      });
      log('info', 'sweep', { msg: `Refs lock held by process: ${lockPath}` });
      continue;
    }

    if (lockAgeS < MIN_LOCK_AGE_SECONDS) {
      skipped++;
      registerEvent('0', 'REFS_LOCK_DETECTED', {
        lock_path: lockPath,
        lock_age_s: lockAgeS,
        decline_reason: 'too_young',
      });
      log('info', 'sweep', { msg: `Refs lock too young (${lockAgeS}s): ${lockPath}` });
      continue;
    }

    // Safe to prune
    try {
      fs.unlinkSync(lockPath);
      pruned++;
      registerEvent('0', 'REFS_LOCK_ORPHAN_PRUNED', {
        lock_path: lockPath,
        lock_age_s: lockAgeS,
        lock_mtime: stat.mtime.toISOString(),
      });
      log('info', 'sweep', { msg: `Pruned orphan refs lock (age ${lockAgeS}s): ${lockPath}` });
    } catch (err) {
      skipped++;
      log('warn', 'sweep', { msg: `Failed to prune refs lock: ${lockPath}`, error: err.message });
    }
  }

  return { pruned, skipped };
}

// ---------------------------------------------------------------------------
// runGit — the centralised git invocation wrapper
// ---------------------------------------------------------------------------

/**
 * runGit(args, opts)
 *
 * Executes a git command via execSync with try/finally finalizer.
 *
 * @param {string} cmd — full command string (e.g. 'git worktree add ...')
 * @param {object} opts
 * @param {string} opts.slice_id — slice ID for register events (default '0')
 * @param {string} opts.op — operation name for logging (e.g. 'createWorktree')
 * @param {string} [opts.cwd] — working directory (default PROJECT_DIR)
 * @param {string} [opts.encoding] — 'utf-8', 'buffer', or undefined
 * @param {object} [opts.execOpts] — additional execSync options (stdio, timeout, maxBuffer)
 * @param {string} [opts.worktreePath] — if this is a worktree-creating op, the expected path
 * @returns {string|Buffer} — execSync result
 */
function runGit(cmd, opts) {
  opts = opts || {};
  const sliceId = opts.slice_id || '0';
  const op = opts.op || 'git';
  const cwd = opts.cwd || PROJECT_DIR;

  const execOpts = Object.assign({ cwd }, opts.execOpts || {});
  if (opts.encoding) execOpts.encoding = opts.encoding;

  registerEvent(sliceId, 'LOCK_CLAIMED', { op, cmd: cmd.slice(0, 120) });

  try {
    const result = execSync(cmd, execOpts);
    registerEvent(sliceId, 'LOCK_RELEASED', { op });
    return result;
  } catch (err) {
    // Finalizer: check for orphan lock and prune if safe
    pruneOrphanLock(sliceId, op);

    // For worktree-creating ops: clean up half-created worktree dir
    if (opts.worktreePath && fs.existsSync(opts.worktreePath)) {
      try {
        assertWorktreePath(opts.worktreePath);
        fs.rmSync(opts.worktreePath, { recursive: true, force: true });
        registerEvent(sliceId, 'WORKTREE_ORPHAN_PRUNED', {
          op,
          artifact: opts.worktreePath,
        });
        log('info', 'git_finalizer', { slice_id: sliceId, op, msg: `Cleaned up partial worktree at ${opts.worktreePath}` });
      } catch (cleanErr) {
        log('warn', 'git_finalizer', { slice_id: sliceId, op, msg: `Failed to clean partial worktree`, error: cleanErr.message });
      }
    }

    throw err; // Re-throw so callers see the original error
  }
}

// ---------------------------------------------------------------------------
// sweepStaleResources — cycle-start cleanup
// ---------------------------------------------------------------------------

/**
 * sweepStaleResources()
 *
 * Runs once at the top of each dispatch tick, BEFORE any slice gets picked up.
 * Idempotent. Emits register events per action taken.
 *
 * 1. Stale lock check
 * 2. Stale worktree check
 *
 * Returns true if dispatch should proceed, false if dispatch should be skipped
 * (e.g. STALE_LOCK_DETECTED — something may be in flight).
 */
function sweepStaleResources() {
  // ── 1. Stale lock check ──────────────────────────────────────────────
  if (lockExists()) {
    let shouldPrune = true;
    let diagnostics = {};

    // Condition A: heartbeat must be idle with old activity
    try {
      const hb = JSON.parse(fs.readFileSync(HEARTBEAT_FILE, 'utf-8'));
      diagnostics.heartbeat_status = hb.status;
      diagnostics.last_activity_ts = hb.last_activity_ts;

      if (hb.status !== 'idle') {
        shouldPrune = false;
        diagnostics.decline_reason = 'heartbeat_not_idle';
      } else {
        const lastActivity = hb.last_activity_ts ? new Date(hb.last_activity_ts).getTime() : 0;
        const age = Date.now() - lastActivity;
        diagnostics.activity_age_s = Math.round(age / 1000);
        if (age < 60000) {
          shouldPrune = false;
          diagnostics.decline_reason = 'activity_too_recent';
        }
      }
    } catch (_) {
      // Can't read heartbeat — decline to prune (ambiguous)
      shouldPrune = false;
      diagnostics.decline_reason = 'heartbeat_unreadable';
    }

    // Condition B: no IN_PROGRESS files
    if (shouldPrune) {
      try {
        const queueFiles = fs.readdirSync(QUEUE_DIR);
        const inProgress = queueFiles.filter(f => f.endsWith('-IN_PROGRESS.md'));
        if (inProgress.length > 0) {
          shouldPrune = false;
          diagnostics.decline_reason = 'in_progress_files_exist';
          diagnostics.in_progress = inProgress;
        }
      } catch (_) {
        shouldPrune = false;
        diagnostics.decline_reason = 'queue_unreadable';
      }
    }

    // Condition C: no live git process
    if (shouldPrune && isGitProcessAlive()) {
      shouldPrune = false;
      diagnostics.decline_reason = 'git_process_alive';
    }

    if (shouldPrune) {
      try {
        const stat = fs.statSync(indexLockPath());
        const lockAge = Math.round((Date.now() - stat.mtimeMs) / 1000);
        fs.unlinkSync(indexLockPath());
        registerEvent('0', 'LOCK_ORPHAN_PRUNED', {
          phase: 'cycle_start_sweep',
          artifact: indexLockPath(),
          lock_mtime: stat.mtime.toISOString(),
          lock_age_s: lockAge,
        });
        log('info', 'sweep', { msg: `Cycle-start: pruned orphan .git/index.lock (age ${lockAge}s)` });
      } catch (err) {
        log('warn', 'sweep', { msg: 'Cycle-start: failed to prune lock', error: err.message });
      }
    } else {
      registerEvent('0', 'STALE_LOCK_DETECTED', diagnostics);
      log('info', 'sweep', { msg: 'Cycle-start: stale lock detected but declined to prune', diagnostics });
      // Something is in flight — skip dispatch this tick
      return false;
    }
  }

  // ── 1b. Refs-lock sweep (slice 219) ─────────────────────────────────
  // Runs under the same gate as index.lock — if we got here, heartbeat is
  // idle, no IN_PROGRESS files, and no live git process on index.lock.
  // Refs locks get their own per-lock lsof + age checks inside
  // pruneOrphanRefsLocks.
  {
    const result = pruneOrphanRefsLocks({});
    if (result.pruned > 0) {
      log('info', 'sweep', { msg: `Cycle-start: pruned ${result.pruned} orphan refs lock(s)` });
    }
  }

  // ── 2. Stale worktree check ──────────────────────────────────────────
  let worktreeDirs;
  try {
    if (!fs.existsSync(WORKTREE_BASE)) return true;
    worktreeDirs = fs.readdirSync(WORKTREE_BASE);
  } catch (_) {
    return true;
  }

  const gitWorktreesDir = path.join(PROJECT_DIR, '.git', 'worktrees');

  for (const dir of worktreeDirs) {
    const fullPath = path.join(WORKTREE_BASE, dir);

    // Skip non-directories
    try {
      if (!fs.statSync(fullPath).isDirectory()) continue;
    } catch (_) {
      continue;
    }

    // Check if git knows about this worktree
    const metadataDir = path.join(gitWorktreesDir, dir);
    let hasValidMetadata = false;

    if (fs.existsSync(metadataDir)) {
      // Metadata dir exists — check if it points back to the right location
      try {
        const gitdirFile = path.join(metadataDir, 'gitdir');
        if (fs.existsSync(gitdirFile)) {
          const gitdirContent = fs.readFileSync(gitdirFile, 'utf-8').trim();
          // If the gitdir file references our worktree path, metadata is valid
          if (gitdirContent.includes(dir)) {
            hasValidMetadata = true;
          }
        }
      } catch (_) {}
    }

    if (!hasValidMetadata) {
      // Orphan worktree dir — no matching git metadata
      try {
        assertWorktreePath(fullPath);
        const stat = fs.statSync(fullPath);
        fs.rmSync(fullPath, { recursive: true, force: true });
        registerEvent('0', 'WORKTREE_ORPHAN_PRUNED', {
          phase: 'cycle_start_sweep',
          artifact: fullPath,
          dir_mtime: stat.mtime.toISOString(),
        });
        log('info', 'sweep', { msg: `Cycle-start: pruned orphan worktree dir ${dir}` });
      } catch (err) {
        log('warn', 'sweep', { msg: `Cycle-start: failed to prune orphan worktree ${dir}`, error: err.message });
      }
    }
  }

  return true;
}

// ---------------------------------------------------------------------------
// createWorktreeWithRetry — retries transient index.lock contention
// ---------------------------------------------------------------------------

/**
 * createWorktreeWithRetry(createFn, id, branchName, maxRetries)
 *
 * Wraps the actual createWorktree call. If it fails with "index.lock File exists",
 * retries up to maxRetries times with exponential backoff (2/4/8/16/32s).
 *
 * @param {Function} createFn — the original createWorktree(id, branchName) function
 * @param {string} id — slice ID
 * @param {string} branchName — branch name
 * @param {number} [maxRetries=5] — max retry attempts
 * @returns {string} worktree path
 */
function createWorktreeWithRetry(createFn, id, branchName, maxRetries) {
  maxRetries = maxRetries != null ? maxRetries : 5;
  let lastErr;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return createFn(id, branchName);
    } catch (err) {
      lastErr = err;
      const errMsg = (err.stderr ? err.stderr.toString() : err.message) || '';

      // Only retry for index.lock contention
      if (!errMsg.includes('index.lock') || !errMsg.includes('File exists')) {
        throw err; // Not a transient lock error — fail immediately
      }

      if (attempt >= maxRetries) {
        // Exhausted retries
        let lockInfo = {};
        try {
          const stat = fs.statSync(indexLockPath());
          lockInfo.lock_mtime = stat.mtime.toISOString();
          lockInfo.lock_age_s = Math.round((Date.now() - stat.mtimeMs) / 1000);
        } catch (_) {}

        // Enrich error with lock metadata for ERROR file
        err.lockInfo = lockInfo;
        err.retryReason = 'branch_creation_blocked_stale';
        throw err;
      }

      // Backoff: 2^(attempt+1) seconds = 2, 4, 8, 16, 32
      const backoffMs = Math.pow(2, attempt + 1) * 1000;
      registerEvent(id, 'WORKTREE_SETUP_RETRY', {
        attempt: attempt + 1,
        max_retries: maxRetries,
        backoff_ms: backoffMs,
        error: errMsg.slice(-200),
      });
      log('warn', 'git_finalizer', {
        slice_id: id,
        msg: `index.lock contention — retry ${attempt + 1}/${maxRetries} in ${backoffMs / 1000}s`,
      });

      // Synchronous sleep (acceptable here — we're blocking dispatch intentionally)
      sleepSync(backoffMs);

      // Try pruning the lock before retrying
      pruneOrphanLock(id, 'worktree_setup_retry');
    }
  }

  throw lastErr;
}

/**
 * sleepSync(ms) — blocking sleep via Atomics.wait
 */
function sleepSync(ms) {
  const sab = new SharedArrayBuffer(4);
  const int32 = new Int32Array(sab);
  Atomics.wait(int32, 0, 0, ms);
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  init,
  runGit,
  sweepStaleResources,
  createWorktreeWithRetry,
  pruneOrphanLock,
  assertWorktreePath,
  findOrphanRefsLocks,
  pruneOrphanRefsLocks,
  // Exposed for testing
  _isGitProcessAlive: isGitProcessAlive,
  _isLockHeldByProcess: isLockHeldByProcess,
  _lockExists: lockExists,
  _indexLockPath: indexLockPath,
  _sleepSync: sleepSync,
  _MIN_LOCK_AGE_SECONDS: MIN_LOCK_AGE_SECONDS,
};
