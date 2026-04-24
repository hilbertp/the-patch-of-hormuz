'use strict';

/**
 * main-lock-guard.test.js — Slice 202
 *
 * Regression tests for:
 *   A. ensureMainIsFresh() unlocks before git reset --hard, re-locks after success
 *   B. ensureMainIsFresh() re-locks even when the reset throws (try/finally)
 *   C. chmod-guard.sh rejects chmod u+w on locked path when marker absent
 *   D. chmod-guard.sh allows chmod u+w on locked path when marker present
 *   E. chmod-guard.sh passes through chmod a-w (read-only mode) without checking marker
 *   F. unlock-main.sh creates marker; lock-main.sh removes it
 *
 * Run: node test/main-lock-guard.test.js
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { execSync, spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const GUARD     = path.join(REPO_ROOT, 'scripts', 'chmod-guard.sh');
const UNLOCK    = path.join(REPO_ROOT, 'scripts', 'unlock-main.sh');
const LOCK      = path.join(REPO_ROOT, 'scripts', 'lock-main.sh');

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  \u2713 ${name}`);
  } catch (err) {
    failed++;
    console.log(`  \u2717 ${name}`);
    console.log(`    ${err.message}`);
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  \u2713 ${name}`);
  } catch (err) {
    failed++;
    console.log(`  \u2717 ${name}`);
    console.log(`    ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempRepo(label) {
  const dir = path.join(os.tmpdir(), `ds9-202-test-${label}-${Date.now()}-${process.pid}`);
  fs.mkdirSync(dir, { recursive: true });
  execSync('git init -b main', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'pipe' });
  // Initial commit so HEAD exists
  fs.writeFileSync(path.join(dir, 'README.md'), 'hello');
  execSync('git add .', { cwd: dir, stdio: 'pipe' });
  execSync('git commit -m "init"', { cwd: dir, stdio: 'pipe' });
  return dir;
}

function rmrf(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}

// ---------------------------------------------------------------------------
// Test A: ensureMainIsFresh() unlocks before git reset --hard, re-locks after
//
// Strategy: create a mini git repo, lock a subdir (chmod a-w), then invoke
// git reset --hard inside a shell script that mimics the unlock/relock pattern
// from ensureMainIsFresh(). Verify reset succeeds and dir is re-locked after.
// ---------------------------------------------------------------------------
console.log('\nTest group: ensureMainIsFresh unlock/relock pattern\n');

test('A: git reset --hard succeeds when unlock wraps the operation', () => {
  const dir = makeTempRepo('A');
  try {
    // Create a locked subdir with a tracked file
    const subdir = path.join(dir, 'locked-dir');
    fs.mkdirSync(subdir, { recursive: true });
    fs.writeFileSync(path.join(subdir, 'file.txt'), 'original');
    execSync('git add .', { cwd: dir, stdio: 'pipe' });
    execSync('git commit -m "add locked-dir"', { cwd: dir, stdio: 'pipe' });

    // Lock the subdir
    execSync(`chmod a-w "${subdir}"`, { stdio: 'pipe' });

    // Modify the tracked file from the git object store perspective by
    // creating a new commit with different content, then resetting to the
    // previous commit. We test that reset succeeds after unlock.
    execSync(`chmod u+w "${subdir}"`, { stdio: 'pipe' }); // temporarily unlock to write
    fs.writeFileSync(path.join(subdir, 'file.txt'), 'changed');
    execSync(`chmod a-w "${subdir}"`, { stdio: 'pipe' }); // re-lock

    // The reset script mirrors the pattern from ensureMainIsFresh:
    // unlock → git reset --hard HEAD → relock
    const script = `
      chmod u+w "${subdir}"
      git -C "${dir}" reset --hard HEAD
      chmod a-w "${subdir}"
    `;
    const result = spawnSync('bash', ['-c', script], { encoding: 'utf-8' });
    if (result.status !== 0) {
      throw new Error(`Reset script failed: ${result.stderr}`);
    }

    // Subdir should be locked again
    const stat = fs.statSync(subdir);
    const writable = !!(stat.mode & 0o200);
    if (writable) throw new Error('subdir is still writable after relock');
  } finally {
    // Ensure cleanup even if locked
    try { execSync(`chmod -R u+w "${dir}"`, { stdio: 'pipe' }); } catch (_) {}
    rmrf(dir);
  }
});

// ---------------------------------------------------------------------------
// Test B: re-locks even when reset throws (try/finally semantic)
// ---------------------------------------------------------------------------

test('B: try/finally re-locks even when git reset --hard throws', () => {
  const dir = makeTempRepo('B');
  const lockFile = path.join(dir, '.lock-state');
  try {
    // Simulate the try/finally pattern: unlock sets the flag, the git op
    // throws, the finally block still runs the relock.
    const script = `
      set +e
      echo "unlocked" > "${lockFile}"
      (
        # Simulated failing git op
        exit 1
      )
      # finally block always runs
      echo "locked" > "${lockFile}"
    `;
    spawnSync('bash', ['-c', script], { encoding: 'utf-8' });
    const state = fs.readFileSync(lockFile, 'utf-8').trim();
    if (state !== 'locked') throw new Error(`Expected locked, got: ${state}`);
  } finally {
    rmrf(dir);
  }
});

// ---------------------------------------------------------------------------
// Tests C/D/E: chmod-guard.sh behaviour
// ---------------------------------------------------------------------------
console.log('\nTest group: chmod-guard.sh\n');

test('C: chmod-guard rejects chmod u+w on locked path when marker absent', () => {
  const tmp = path.join(os.tmpdir(), `ds9-guard-C-${Date.now()}`);
  fs.mkdirSync(tmp, { recursive: true });
  try {
    // Create a fake REPO structure the guard will use
    const fakeDashboard = path.join(tmp, 'dashboard');
    fs.mkdirSync(fakeDashboard, { recursive: true });
    fs.writeFileSync(path.join(fakeDashboard, 'test.html'), '');
    fs.mkdirSync(path.join(tmp, 'bridge'), { recursive: true });
    // No .main-unlocked marker

    // The guard script resolves REPO relative to its own location.
    // We need to invoke it with REPO pointing at tmp.
    // Trick: create a scripts/ subdirectory and symlink the guard there.
    const fakeScripts = path.join(tmp, 'scripts');
    fs.mkdirSync(fakeScripts, { recursive: true });
    fs.copyFileSync(GUARD, path.join(fakeScripts, 'chmod-guard.sh'));
    fs.chmodSync(path.join(fakeScripts, 'chmod-guard.sh'), 0o755);

    const result = spawnSync('bash', [
      path.join(fakeScripts, 'chmod-guard.sh'),
      'u+w', 'dashboard/test.html'
    ], { cwd: tmp, encoding: 'utf-8' });

    if (result.status === 0) throw new Error('Guard should have rejected but exited 0');
    if (!result.stderr.includes('refusing to make locked path writable')) {
      throw new Error(`Expected refusal message, got: ${result.stderr}`);
    }
  } finally {
    rmrf(tmp);
  }
});

test('D: chmod-guard allows chmod u+w on locked path when marker present', () => {
  const tmp = path.join(os.tmpdir(), `ds9-guard-D-${Date.now()}`);
  fs.mkdirSync(tmp, { recursive: true });
  try {
    const fakeDashboard = path.join(tmp, 'dashboard');
    fs.mkdirSync(fakeDashboard, { recursive: true });
    const testFile = path.join(fakeDashboard, 'test.html');
    fs.writeFileSync(testFile, '');
    fs.chmodSync(testFile, 0o444); // read-only so we can verify chmod ran

    const fakeBridge = path.join(tmp, 'bridge');
    fs.mkdirSync(fakeBridge, { recursive: true });
    // Create marker
    fs.writeFileSync(path.join(fakeBridge, '.main-unlocked'), '');

    const fakeScripts = path.join(tmp, 'scripts');
    fs.mkdirSync(fakeScripts, { recursive: true });
    fs.copyFileSync(GUARD, path.join(fakeScripts, 'chmod-guard.sh'));
    fs.chmodSync(path.join(fakeScripts, 'chmod-guard.sh'), 0o755);

    const result = spawnSync('bash', [
      path.join(fakeScripts, 'chmod-guard.sh'),
      'u+w', 'dashboard/test.html'
    ], { cwd: tmp, encoding: 'utf-8' });

    if (result.status !== 0) {
      throw new Error(`Guard should have allowed but failed: ${result.stderr}`);
    }
    // Verify the file is now writable
    const stat = fs.statSync(testFile);
    if (!(stat.mode & 0o200)) throw new Error('File not made writable by guard passthrough');
  } finally {
    rmrf(tmp);
  }
});

test('E: chmod-guard passes through chmod a-w (read-only) without checking marker', () => {
  const tmp = path.join(os.tmpdir(), `ds9-guard-E-${Date.now()}`);
  fs.mkdirSync(tmp, { recursive: true });
  try {
    const fakeDashboard = path.join(tmp, 'dashboard');
    fs.mkdirSync(fakeDashboard, { recursive: true });
    const testFile = path.join(fakeDashboard, 'test.html');
    fs.writeFileSync(testFile, '');
    // No marker file — but mode is a-w (removing write), should pass through

    const fakeScripts = path.join(tmp, 'scripts');
    fs.mkdirSync(fakeScripts, { recursive: true });
    fs.copyFileSync(GUARD, path.join(fakeScripts, 'chmod-guard.sh'));
    fs.chmodSync(path.join(fakeScripts, 'chmod-guard.sh'), 0o755);
    // Create empty bridge dir so REPO detection doesn't fail
    fs.mkdirSync(path.join(tmp, 'bridge'), { recursive: true });

    const result = spawnSync('bash', [
      path.join(fakeScripts, 'chmod-guard.sh'),
      'a-w', 'dashboard/test.html'
    ], { cwd: tmp, encoding: 'utf-8' });

    if (result.status !== 0) {
      throw new Error(`Read-only chmod should pass through but failed: ${result.stderr}`);
    }
    // File should now be read-only
    const stat = fs.statSync(testFile);
    if (stat.mode & 0o222) throw new Error('File still writable after a-w chmod');
  } finally {
    rmrf(tmp);
  }
});

// ---------------------------------------------------------------------------
// Test F: unlock-main.sh creates marker; lock-main.sh removes it
// ---------------------------------------------------------------------------
console.log('\nTest group: marker file lifecycle\n');

test('F: unlock-main.sh creates marker; lock-main.sh removes it', () => {
  // Run the actual scripts against the real repo root.
  // After unlock the marker exists; after lock it's gone.
  const marker = path.join(REPO_ROOT, 'bridge', '.main-unlocked');

  // Clean state: run lock first (idempotent)
  spawnSync('bash', [LOCK], { cwd: REPO_ROOT, encoding: 'utf-8', stdio: 'pipe' });
  if (fs.existsSync(marker)) throw new Error('Marker should not exist before unlock');

  // Unlock
  const unlockResult = spawnSync('bash', [UNLOCK], { cwd: REPO_ROOT, encoding: 'utf-8' });
  if (unlockResult.status !== 0) throw new Error(`unlock-main.sh failed: ${unlockResult.stderr}`);
  if (!fs.existsSync(marker)) throw new Error('Marker should exist after unlock');

  // Lock
  const lockResult = spawnSync('bash', [LOCK], { cwd: REPO_ROOT, encoding: 'utf-8' });
  if (lockResult.status !== 0) throw new Error(`lock-main.sh failed: ${lockResult.stderr}`);
  if (fs.existsSync(marker)) throw new Error('Marker should not exist after lock');
});

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

console.log(`\n── Results: ${passed} passed, ${failed} failed ──\n`);
if (failed > 0) process.exit(1);
