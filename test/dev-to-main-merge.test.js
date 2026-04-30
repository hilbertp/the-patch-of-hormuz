'use strict';

/**
 * dev-to-main-merge.test.js — Slice 269
 *
 * Simulates regression-pass and verifies:
 *   1. Lock unlock → merge --no-ff → push → fast-forward dev → relock
 *   2. Events emitted in correct order
 *   3. branch-state updated correctly post-merge
 *
 * Run: node test/dev-to-main-merge.test.js
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { execSync } = require('child_process');

const { mergeDevToMain, _testSetProjectDir, _testSetRegisterFile } = require('../bridge/orchestrator');
const telemetry = require('../bridge/state/gate-telemetry');

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
    if (err.stack) console.log(`    ${err.stack.split('\n').slice(1, 3).join('\n    ')}`);
  }
}

// ---------------------------------------------------------------------------
// Test repo setup — creates bare+clone with main, dev, and squashed commits
// ---------------------------------------------------------------------------

function setupTestRepo(opts = {}) {
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'merge269-'));
  const bareDir = path.join(tmp, 'bare.git');
  const workDir = path.join(tmp, 'work');

  execSync(`git init --bare --initial-branch=main ${bareDir}`, { stdio: 'pipe' });
  execSync(`git clone ${bareDir} ${workDir}`, { stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: workDir, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: workDir, stdio: 'pipe' });

  // Initial commit on main
  fs.writeFileSync(path.join(workDir, 'base.txt'), 'base\n');
  execSync('git add base.txt', { cwd: workDir, stdio: 'pipe' });
  execSync('git commit -m "initial"', { cwd: workDir, stdio: 'pipe' });
  execSync('git push origin main', { cwd: workDir, stdio: 'pipe' });

  // Create dev branch and add squashed slice commits
  execSync('git checkout -b dev', { cwd: workDir, stdio: 'pipe' });

  const sliceIds = opts.sliceIds || ['100', '101'];
  for (const sid of sliceIds) {
    fs.writeFileSync(path.join(workDir, `slice-${sid}.txt`), `feature from slice ${sid}\n`);
    execSync(`git add slice-${sid}.txt`, { cwd: workDir, stdio: 'pipe' });
    execSync(`git commit -m "slice ${sid}: feature work (slice ${sid})"`, { cwd: workDir, stdio: 'pipe' });
  }
  execSync('git push origin dev', { cwd: workDir, stdio: 'pipe' });

  const devSha = execSync('git rev-parse dev', { cwd: workDir, encoding: 'utf-8' }).trim();

  // Switch back to main for the merge operation
  execSync('git checkout main', { cwd: workDir, stdio: 'pipe' });

  // Set up bridge dirs
  const bridgeStateDir = path.join(workDir, 'bridge', 'state');
  fs.mkdirSync(bridgeStateDir, { recursive: true });

  // Create lock/unlock scripts (no-ops for test)
  const scriptsDir = path.join(workDir, 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.writeFileSync(path.join(scriptsDir, 'unlock-main.sh'), '#!/bin/bash\necho unlock-main-test\n');
  fs.writeFileSync(path.join(scriptsDir, 'lock-main.sh'), '#!/bin/bash\necho lock-main-test\n');

  const branchStatePath = path.join(bridgeStateDir, 'branch-state.json');
  const branchState = {
    schema_version: 1,
    main: { tip_sha: null, tip_subject: null, tip_ts: null },
    dev: {
      tip_sha: devSha,
      tip_ts: new Date().toISOString(),
      commits_ahead_of_main: sliceIds.length,
      commits: sliceIds.map(sid => ({
        sha: devSha,
        slice_id: sid,
        title: `feature work`,
        subject: `slice ${sid}: feature work (slice ${sid})`,
        ts: new Date().toISOString(),
        is_pending_squash: false,
      })),
      deferred_slices: [],
    },
    last_merge: null,
    gate: { status: 'GATE_RUNNING', current_run: { started_ts: new Date().toISOString(), snapshot_dev_tip_sha: devSha }, last_failure: null, last_pass: null },
  };
  fs.writeFileSync(branchStatePath, JSON.stringify(branchState, null, 2) + '\n');

  // Create gate-running.json (mutex held)
  const mutexPath = path.join(bridgeStateDir, 'gate-running.json');
  fs.writeFileSync(mutexPath, JSON.stringify({
    schema_version: 1,
    started_ts: new Date().toISOString(),
    dev_tip_sha: devSha,
    bashir_pid: null,
    bashir_heartbeat_path: 'bridge/state/bashir-heartbeat.json',
  }) + '\n');

  // Register file
  const registerPath = path.join(workDir, 'bridge', 'register.jsonl');
  fs.writeFileSync(registerPath, '');

  // Redirect orchestrator
  _testSetProjectDir(workDir);
  _testSetRegisterFile(registerPath);
  telemetry.setRegisterPath(registerPath);

  function cleanup() {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  }

  return { repoDir: workDir, branchStatePath, registerPath, mutexPath, bareDir, cleanup, devSha };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

console.log('\ndev-to-main-merge.test.js (slice 269)\n');

test('mergeDevToMain succeeds and updates branch-state', () => {
  const { repoDir, branchStatePath, cleanup } = setupTestRepo();
  try {
    const result = mergeDevToMain();

    assert.strictEqual(result.success, true, 'merge should succeed');
    assert.ok(result.merge_sha, 'merge_sha should be set');

    // Verify branch-state
    const state = JSON.parse(fs.readFileSync(branchStatePath, 'utf-8'));
    assert.strictEqual(state.main.tip_sha, result.merge_sha, 'main.tip_sha should match merge sha');
    assert.ok(state.main.tip_subject.includes('slices'), 'main.tip_subject should mention slices');
    assert.strictEqual(state.dev.tip_sha, result.merge_sha, 'dev.tip_sha should equal main (fast-forwarded)');
    assert.deepStrictEqual(state.dev.commits, [], 'dev.commits should be empty');
    assert.strictEqual(state.dev.commits_ahead_of_main, 0, 'commits_ahead_of_main should be 0');
    assert.strictEqual(state.gate.status, 'IDLE', 'gate.status should be IDLE');
    assert.strictEqual(state.gate.current_run, null, 'current_run should be null');
    assert.strictEqual(state.gate.last_failure, null, 'last_failure should be null');

    // Verify last_merge
    assert.ok(state.last_merge, 'last_merge should be populated');
    assert.strictEqual(state.last_merge.merge_sha, result.merge_sha);
    assert.deepStrictEqual(state.last_merge.slices, ['100', '101']);
  } finally {
    cleanup();
  }
});

test('mergeDevToMain emits events in correct order', () => {
  const { repoDir, registerPath, cleanup } = setupTestRepo();
  try {
    mergeDevToMain();

    const events = fs.readFileSync(registerPath, 'utf-8')
      .trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
    const eventNames = events.map(e => e.event);

    // Should have: lock-cycle unlock, lock-cycle relock (from inner),
    // merge-complete, gate-mutex-released, lock-cycle relock (from finally)
    assert.ok(eventNames.includes('merge-complete'), 'should emit merge-complete');
    assert.ok(eventNames.includes('gate-mutex-released'), 'should emit gate-mutex-released');

    // merge-complete should come before gate-mutex-released
    const mcIdx = eventNames.indexOf('merge-complete');
    const mrIdx = eventNames.indexOf('gate-mutex-released');
    assert.ok(mcIdx < mrIdx, 'merge-complete should come before gate-mutex-released');

    // Verify merge-complete payload
    const mc = events.find(e => e.event === 'merge-complete');
    assert.ok(mc.merge_sha, 'merge-complete should have merge_sha');
    assert.deepStrictEqual(mc.slices, ['100', '101'], 'merge-complete should list slices');
    assert.strictEqual(mc.dev_fast_forwarded_to, mc.merge_sha, 'dev_fast_forwarded_to should match merge_sha');
  } finally {
    cleanup();
  }
});

test('merge commit is --no-ff (has two parents)', () => {
  const { repoDir, cleanup } = setupTestRepo();
  try {
    const result = mergeDevToMain();
    assert.ok(result.success);

    // Check parent count of merge commit
    const parents = execSync(`git cat-file -p ${result.merge_sha}`, { cwd: repoDir, encoding: 'utf-8' });
    const parentLines = parents.split('\n').filter(l => l.startsWith('parent '));
    assert.strictEqual(parentLines.length, 2, 'merge commit should have 2 parents (--no-ff)');
  } finally {
    cleanup();
  }
});

test('first parent of merge commit is prior main tip', () => {
  const { repoDir, cleanup } = setupTestRepo();
  try {
    // Record main tip before merge
    const priorMainTip = execSync('git rev-parse main', { cwd: repoDir, encoding: 'utf-8' }).trim();

    const result = mergeDevToMain();
    assert.ok(result.success);

    // First parent should be the old main
    const firstParent = execSync(`git rev-parse ${result.merge_sha}^1`, { cwd: repoDir, encoding: 'utf-8' }).trim();
    assert.strictEqual(firstParent, priorMainTip, 'first parent should be prior main tip');
  } finally {
    cleanup();
  }
});

test('mutex is released after merge', () => {
  const { repoDir, registerPath, cleanup } = setupTestRepo();
  try {
    mergeDevToMain();

    // Verify via telemetry that gate-mutex-released was emitted
    const events = fs.readFileSync(registerPath, 'utf-8')
      .trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
    const released = events.find(e => e.event === 'gate-mutex-released');
    assert.ok(released, 'gate-mutex-released event should be emitted');
    assert.strictEqual(released.reason, 'regression_pass', 'release reason should be regression_pass');
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
console.log('');
console.log(`  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
