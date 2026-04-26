'use strict';

/**
 * orchestrator-refs-lock-selfheal.test.js — Slice 219
 *
 * Regression tests A–G for the refs-lock self-heal extension.
 *
 * Run: node test/orchestrator-refs-lock-selfheal.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const gitFinalizer = require('../bridge/git-finalizer.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
  }
}

function createTestEnv() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'refs-lock-test-'));
  const gitDir = path.join(tmpDir, '.git');
  const refsHeadsDir = path.join(gitDir, 'refs', 'heads', 'slice');
  const queueDir = path.join(tmpDir, 'queue');
  const heartbeatFile = path.join(tmpDir, 'heartbeat.json');

  fs.mkdirSync(refsHeadsDir, { recursive: true });
  fs.mkdirSync(queueDir, { recursive: true });

  fs.writeFileSync(heartbeatFile, JSON.stringify({
    ts: new Date().toISOString(),
    status: 'idle',
    last_activity_ts: new Date(Date.now() - 120000).toISOString(),
  }));

  const events = [];
  const logs = [];

  gitFinalizer.init({
    PROJECT_DIR: tmpDir,
    registerEvent: (sliceId, event, data) => {
      events.push({ sliceId, event, ...data });
    },
    log: (level, source, data) => {
      logs.push({ level, source, ...data });
    },
    HEARTBEAT_FILE: heartbeatFile,
    QUEUE_DIR: queueDir,
  });

  return { tmpDir, gitDir, refsHeadsDir, queueDir, heartbeatFile, events, logs };
}

function cleanup(tmpDir) {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

function createOldLock(lockPath, ageSeconds) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, '');
  const past = new Date(Date.now() - ageSeconds * 1000);
  fs.utimesSync(lockPath, past, past);
}

function createFreshLock(lockPath) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, '');
}

console.log('\nrefs-lock self-heal — regression tests (slice 219)');

test('A: orphan refs/heads/slice/foo.lock (>30s, no holder) → pruned', () => {
  const env = createTestEnv();
  try {
    const lockPath = path.join(env.refsHeadsDir, 'foo.lock');
    createOldLock(lockPath, 60);
    const result = gitFinalizer.pruneOrphanRefsLocks({});
    assert.strictEqual(result.pruned, 1);
    assert.strictEqual(result.skipped, 0);
    assert.strictEqual(fs.existsSync(lockPath), false);
    const ev = env.events.find(e => e.event === 'REFS_LOCK_ORPHAN_PRUNED');
    assert.ok(ev);
    assert.strictEqual(ev.lock_path, lockPath);
    assert.ok(ev.lock_age_s >= 59);
    assert.ok(ev.lock_mtime);
  } finally { cleanup(env.tmpDir); }
});

test('B: orphan packed-refs.lock (>30s, no holder) → pruned', () => {
  const env = createTestEnv();
  try {
    const lockPath = path.join(env.gitDir, 'packed-refs.lock');
    createOldLock(lockPath, 60);
    const result = gitFinalizer.pruneOrphanRefsLocks({});
    assert.strictEqual(result.pruned, 1);
    assert.strictEqual(fs.existsSync(lockPath), false);
    const ev = env.events.find(e => e.event === 'REFS_LOCK_ORPHAN_PRUNED');
    assert.ok(ev);
    assert.strictEqual(ev.lock_path, lockPath);
  } finally { cleanup(env.tmpDir); }
});

test('C: fresh lock (<30s) → not pruned, REFS_LOCK_DETECTED with too_young', () => {
  const env = createTestEnv();
  try {
    const lockPath = path.join(env.refsHeadsDir, 'bar.lock');
    createFreshLock(lockPath);
    const result = gitFinalizer.pruneOrphanRefsLocks({});
    assert.strictEqual(result.pruned, 0);
    assert.strictEqual(result.skipped, 1);
    assert.strictEqual(fs.existsSync(lockPath), true);
    const ev = env.events.find(e => e.event === 'REFS_LOCK_DETECTED');
    assert.ok(ev);
    assert.strictEqual(ev.decline_reason, 'too_young');
  } finally { cleanup(env.tmpDir); }
});

test('D: lock held by process → not pruned, REFS_LOCK_DETECTED with process_alive', () => {
  const env = createTestEnv();
  try {
    const lockPath = path.join(env.refsHeadsDir, 'held.lock');
    createOldLock(lockPath, 60);
    const fd = fs.openSync(lockPath, 'r');
    try {
      const result = gitFinalizer.pruneOrphanRefsLocks({});
      assert.strictEqual(result.pruned, 0);
      assert.strictEqual(result.skipped, 1);
      assert.strictEqual(fs.existsSync(lockPath), true);
      const ev = env.events.find(e => e.event === 'REFS_LOCK_DETECTED');
      assert.ok(ev);
      assert.strictEqual(ev.decline_reason, 'process_alive');
    } finally { fs.closeSync(fd); }
  } finally { cleanup(env.tmpDir); }
});

test('E: heartbeat busy → sweepStaleResources skips refs-lock sweep', () => {
  const env = createTestEnv();
  try {
    fs.writeFileSync(env.heartbeatFile, JSON.stringify({
      ts: new Date().toISOString(),
      status: 'processing',
      current_slice: '999',
      last_activity_ts: new Date().toISOString(),
    }));
    const lockPath = path.join(env.refsHeadsDir, 'busy.lock');
    createOldLock(lockPath, 60);
    const indexLock = path.join(env.gitDir, 'index.lock');
    createOldLock(indexLock, 60);
    const result = gitFinalizer.sweepStaleResources();
    assert.strictEqual(result, false);
    assert.strictEqual(fs.existsSync(lockPath), true);
    const refsEvents = env.events.filter(e =>
      e.event === 'REFS_LOCK_ORPHAN_PRUNED' || e.event === 'REFS_LOCK_DETECTED'
    );
    assert.strictEqual(refsEvents.length, 0);
  } finally { cleanup(env.tmpDir); }
});

test('F: no locks present → sweep returns true, no refs-lock events', () => {
  const env = createTestEnv();
  try {
    const result = gitFinalizer.sweepStaleResources();
    assert.strictEqual(result, true);
    const refsEvents = env.events.filter(e =>
      e.event === 'REFS_LOCK_ORPHAN_PRUNED' || e.event === 'REFS_LOCK_DETECTED'
    );
    assert.strictEqual(refsEvents.length, 0);
  } finally { cleanup(env.tmpDir); }
});

test('G: multiple locks (one orphan, one held) → orphan pruned, held one detected', () => {
  const env = createTestEnv();
  try {
    const orphanLock = path.join(env.refsHeadsDir, 'orphan.lock');
    createOldLock(orphanLock, 60);
    const heldLock = path.join(env.refsHeadsDir, 'held.lock');
    createOldLock(heldLock, 60);
    const fd = fs.openSync(heldLock, 'r');
    try {
      const result = gitFinalizer.pruneOrphanRefsLocks({});
      assert.strictEqual(result.pruned, 1);
      assert.strictEqual(result.skipped, 1);
      assert.strictEqual(fs.existsSync(orphanLock), false);
      assert.strictEqual(fs.existsSync(heldLock), true);
      const pruneEvs = env.events.filter(e => e.event === 'REFS_LOCK_ORPHAN_PRUNED');
      assert.strictEqual(pruneEvs.length, 1);
      assert.strictEqual(pruneEvs[0].lock_path, orphanLock);
      const detectEvs = env.events.filter(e => e.event === 'REFS_LOCK_DETECTED');
      assert.strictEqual(detectEvs.length, 1);
      assert.strictEqual(detectEvs[0].decline_reason, 'process_alive');
    } finally { fs.closeSync(fd); }
  } finally { cleanup(env.tmpDir); }
});

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
