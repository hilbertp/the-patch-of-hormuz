'use strict';

/**
 * ensure-main-fresh.test.js — Slice 209
 *
 * Regression tests for ensureMainIsFresh() push-not-reset fix.
 * Replaces the 2026-04-24 main-rewind root cause (hard-reset on ahead-only).
 *
 * Tests:
 *   A — in sync: no push, no merge, no reset
 *   B — ahead only (3 commits): push invoked, no reset, MAIN_PUSHED_TO_ORIGIN emitted
 *   C — behind only (2 commits): merge --ff-only invoked, no push
 *   D — diverged (ahead 1, behind 1): throws Error, no mutations
 *   E — unlock/relock wrapping: marker appears before write op, gone after
 *
 * Run: node test/ensure-main-fresh.test.js
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const assert = require('assert');

const REPO_ROOT     = path.resolve(__dirname, '..');
const BRIDGE_DIR    = path.join(REPO_ROOT, 'bridge');
const MARKER_FILE   = path.join(BRIDGE_DIR, '.main-unlocked');
const LOCK_SCRIPT   = path.join(REPO_ROOT, 'scripts', 'lock-main.sh');
const UNLOCK_SCRIPT = path.join(REPO_ROOT, 'scripts', 'unlock-main.sh');

const gitFinalizer = require('../bridge/git-finalizer');
const { ensureMainIsFresh, _testSetRegisterFile } = require('../bridge/orchestrator.js');

// ---------------------------------------------------------------------------
// Test harness
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEMP_REG = path.join(os.tmpdir(), `ds9-209-test-register-${process.pid}.jsonl`);

function readRegEvents() {
  try {
    return fs.readFileSync(TEMP_REG, 'utf-8')
      .split('\n').filter(Boolean)
      .map(l => JSON.parse(l));
  } catch (_) {
    return [];
  }
}

function clearReg() {
  try { fs.unlinkSync(TEMP_REG); } catch (_) {}
}

// originalRunGit — saved so we can restore after each test
const originalRunGit = gitFinalizer.runGit;

/**
 * makeMockRunGit(responses)
 *
 * Returns a mock runGit that returns values from `responses` in order.
 * Each entry: { match: regex-or-string, returns: value }
 * If match is null, it's a catch-all.
 * Recorded calls are pushed to the `calls` array on the returned function.
 */
function makeMockRunGit(responses) {
  const calls = [];
  const mock = function mockRunGit(cmd, opts) {
    calls.push(cmd);
    for (const r of responses) {
      if (r.match == null || (typeof r.match === 'string' && cmd.includes(r.match)) ||
          (r.match instanceof RegExp && r.match.test(cmd))) {
        if (r.throws) throw new Error(r.throws);
        return r.returns !== undefined ? r.returns : '';
      }
    }
    return '';
  };
  mock.calls = calls;
  return mock;
}

// Ensure gitFinalizer has minimal init so internal references don't crash
// (registerEvent / log inside runGit are bypassed since we monkeypatch runGit itself)
gitFinalizer.init({
  PROJECT_DIR: REPO_ROOT,
  registerEvent: () => {},
  log: () => {},
  HEARTBEAT_FILE: path.join(BRIDGE_DIR, 'heartbeat.json'),
  QUEUE_DIR: path.join(BRIDGE_DIR, 'queue'),
});

// Redirect orchestrator's REGISTER_FILE to a temp path for all tests
_testSetRegisterFile(TEMP_REG);

// Clean marker state before suite
try { require('child_process').execSync(`bash "${LOCK_SCRIPT}"`, { cwd: REPO_ROOT, stdio: 'pipe' }); } catch (_) {}

// ---------------------------------------------------------------------------
// Test A — in sync: no write ops invoked
// ---------------------------------------------------------------------------

console.log('\nTest group: ensureMainIsFresh push-not-reset\n');

test('A: in sync — no push, no merge, no reset', () => {
  clearReg();
  const mock = makeMockRunGit([
    { match: 'fetch',                  returns: '' },
    { match: 'rev-parse main',         returns: 'abc123abc123\n' },
    { match: 'rev-parse origin/main',  returns: 'abc123abc123\n' },
    // No further calls expected — early return on local === remote
  ]);
  gitFinalizer.runGit = mock;
  try {
    ensureMainIsFresh('test-a');
  } finally {
    gitFinalizer.runGit = originalRunGit;
  }

  const writeOps = mock.calls.filter(c =>
    c.includes('push') || c.includes('merge') || c.includes('reset'));
  assert.strictEqual(writeOps.length, 0, `Expected no write ops, got: ${writeOps.join(', ')}`);
  const events = readRegEvents().filter(e => e.event === 'MAIN_PUSHED_TO_ORIGIN');
  assert.strictEqual(events.length, 0, 'No MAIN_PUSHED_TO_ORIGIN should be emitted on in-sync');
});

// ---------------------------------------------------------------------------
// Test B — ahead only: push invoked, no reset, MAIN_PUSHED_TO_ORIGIN emitted
// ---------------------------------------------------------------------------

test('B: ahead only (3 commits) — push invoked, no reset, MAIN_PUSHED_TO_ORIGIN emitted with ahead_count=3', () => {
  clearReg();
  const mock = makeMockRunGit([
    { match: 'fetch',                             returns: '' },
    { match: 'rev-parse main',                    returns: 'def456def456\n' },
    { match: 'rev-parse origin/main',             returns: 'abc123abc123\n' },
    { match: 'rev-list --count origin/main..main', returns: '3\n' },
    { match: 'rev-list --count main..origin/main', returns: '0\n' },
    { match: 'push origin main',                   returns: '' },
    { match: 'rev-parse main',                    returns: 'def456def456\n' },
  ]);
  gitFinalizer.runGit = mock;
  try {
    ensureMainIsFresh('test-b');
  } finally {
    gitFinalizer.runGit = originalRunGit;
    try { require('child_process').execSync(`bash "${LOCK_SCRIPT}"`, { cwd: REPO_ROOT, stdio: 'pipe' }); } catch (_) {}
  }

  // push called
  assert.ok(mock.calls.some(c => c.includes('push origin main')), 'git push origin main must be called');
  // reset NOT called
  assert.ok(!mock.calls.some(c => c.includes('reset')), 'git reset must NOT be called');
  // MAIN_PUSHED_TO_ORIGIN event emitted
  const events = readRegEvents().filter(e => e.event === 'MAIN_PUSHED_TO_ORIGIN');
  assert.strictEqual(events.length, 1, 'Exactly one MAIN_PUSHED_TO_ORIGIN event expected');
  assert.strictEqual(events[0].ahead_count, 3, 'ahead_count must be 3');
  assert.ok(events[0].sha, 'sha must be present');
});

// ---------------------------------------------------------------------------
// Test C — behind only: merge --ff-only invoked, no push
// ---------------------------------------------------------------------------

test('C: behind only (2 commits) — merge --ff-only invoked, no push', () => {
  clearReg();
  const mock = makeMockRunGit([
    { match: 'fetch',                              returns: '' },
    { match: 'rev-parse main',                     returns: 'abc123abc123\n' },
    { match: 'rev-parse origin/main',              returns: 'xyz789xyz789\n' },
    { match: 'rev-list --count origin/main..main',  returns: '0\n' },
    { match: 'rev-list --count main..origin/main',  returns: '2\n' },
    { match: 'merge --ff-only origin/main',         returns: '' },
    { match: 'rev-parse main',                     returns: 'xyz789xyz789\n' },
  ]);
  gitFinalizer.runGit = mock;
  try {
    ensureMainIsFresh('test-c');
  } finally {
    gitFinalizer.runGit = originalRunGit;
    try { require('child_process').execSync(`bash "${LOCK_SCRIPT}"`, { cwd: REPO_ROOT, stdio: 'pipe' }); } catch (_) {}
  }

  assert.ok(mock.calls.some(c => c.includes('merge --ff-only origin/main')), 'merge --ff-only must be called');
  assert.ok(!mock.calls.some(c => c.includes('push')), 'git push must NOT be called');
  assert.ok(!mock.calls.some(c => c.includes('reset')), 'git reset must NOT be called');
});

// ---------------------------------------------------------------------------
// Test D — diverged: throws Error, no mutations
// ---------------------------------------------------------------------------

test('D: diverged (ahead 1, behind 1) — throws Error with counts, no mutations', () => {
  clearReg();
  const mock = makeMockRunGit([
    { match: 'fetch',                              returns: '' },
    { match: 'rev-parse main',                     returns: 'aaa111aaa111\n' },
    { match: 'rev-parse origin/main',              returns: 'bbb222bbb222\n' },
    { match: 'rev-list --count origin/main..main',  returns: '1\n' },
    { match: 'rev-list --count main..origin/main',  returns: '1\n' },
    // No further calls expected — divergence throws before unlock/push/merge
  ]);
  gitFinalizer.runGit = mock;
  let thrown = null;
  try {
    ensureMainIsFresh('test-d');
  } catch (err) {
    thrown = err;
  } finally {
    gitFinalizer.runGit = originalRunGit;
  }

  assert.ok(thrown, 'An error must be thrown for true divergence');
  assert.ok(thrown.message.includes('1'), 'Error message must include the counts');
  assert.ok(thrown.message.includes('Operator intervention required'), 'Error must mention operator intervention');
  const mutations = mock.calls.filter(c =>
    c.includes('reset') || c.includes('push') || c.includes('merge'));
  assert.strictEqual(mutations.length, 0, `No git mutations must occur: ${mutations.join(', ')}`);
});

// ---------------------------------------------------------------------------
// Test E — unlock/relock wrapping
//
// Strategy: monkeypatch runGit so that when push/merge is called, we verify
// the .main-unlocked marker exists (unlock ran before the op). After the
// full call, verify the marker is gone (lock ran in finally).
// ---------------------------------------------------------------------------

test('E: push path — unlock marker present during push, gone after', () => {
  clearReg();
  // Ensure clean state: lock
  try { require('child_process').execSync(`bash "${LOCK_SCRIPT}"`, { cwd: REPO_ROOT, stdio: 'pipe' }); } catch (_) {}
  assert.ok(!fs.existsSync(MARKER_FILE), 'Marker must not exist before test');

  let markerDuringPush = null;

  const mock = makeMockRunGit([
    { match: 'fetch',                              returns: '' },
    { match: 'rev-parse main',                     returns: 'def456\n' },
    { match: 'rev-parse origin/main',              returns: 'abc123\n' },
    { match: 'rev-list --count origin/main..main',  returns: '2\n' },
    { match: 'rev-list --count main..origin/main',  returns: '0\n' },
    { match: null, returns: '' }, // push + verifyPush
  ]);
  // Override the catch-all to capture marker state during push
  const originalMock = mock;
  gitFinalizer.runGit = function(cmd, opts) {
    if (cmd.includes('push origin main')) {
      markerDuringPush = fs.existsSync(MARKER_FILE);
    }
    return originalMock(cmd, opts);
  };
  gitFinalizer.runGit.calls = originalMock.calls;

  try {
    ensureMainIsFresh('test-e');
  } finally {
    gitFinalizer.runGit = originalRunGit;
    try { require('child_process').execSync(`bash "${LOCK_SCRIPT}"`, { cwd: REPO_ROOT, stdio: 'pipe' }); } catch (_) {}
  }

  assert.strictEqual(markerDuringPush, true, 'Unlock marker must exist during push (unlock ran before op)');
  assert.ok(!fs.existsSync(MARKER_FILE), 'Unlock marker must be gone after call (lock ran in finally)');
});

test('E: ff-merge path — unlock marker present during merge, gone after', () => {
  clearReg();
  try { require('child_process').execSync(`bash "${LOCK_SCRIPT}"`, { cwd: REPO_ROOT, stdio: 'pipe' }); } catch (_) {}
  assert.ok(!fs.existsSync(MARKER_FILE), 'Marker must not exist before test');

  let markerDuringMerge = null;

  gitFinalizer.runGit = function(cmd) {
    if (cmd.includes('merge --ff-only')) {
      markerDuringMerge = fs.existsSync(MARKER_FILE);
    }
    if (cmd.includes('fetch'))                               return '';
    if (cmd.includes('rev-parse main'))                      return 'abc123\n';
    if (cmd.includes('rev-parse origin/main'))               return 'def456\n';
    if (cmd.includes('rev-list --count origin/main..main'))  return '0\n';
    if (cmd.includes('rev-list --count main..origin/main'))  return '2\n';
    return '';
  };

  try {
    ensureMainIsFresh('test-e2');
  } finally {
    gitFinalizer.runGit = originalRunGit;
    try { require('child_process').execSync(`bash "${LOCK_SCRIPT}"`, { cwd: REPO_ROOT, stdio: 'pipe' }); } catch (_) {}
  }

  assert.strictEqual(markerDuringMerge, true, 'Unlock marker must exist during merge (unlock ran before op)');
  assert.ok(!fs.existsSync(MARKER_FILE), 'Unlock marker must be gone after call (lock ran in finally)');
});

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

clearReg();
// Restore register file path to real path
_testSetRegisterFile(path.join(BRIDGE_DIR, 'register.jsonl'));

console.log(`\n── Results: ${passed} passed, ${failed} failed ──\n`);
if (failed > 0) process.exit(1);
