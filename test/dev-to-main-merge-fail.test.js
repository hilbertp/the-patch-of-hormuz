'use strict';

/**
 * dev-to-main-merge-fail.test.js — Slice 269
 *
 * Simulates failure scenarios (push reject, no slices) and verifies:
 *   1. gate-abort fires
 *   2. Mutex released
 *   3. No partial main state
 *
 * Run: node test/dev-to-main-merge-fail.test.js
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

function setupTestRepo(opts = {}) {
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mergefail269-'));
  const bareDir = path.join(tmp, 'bare.git');
  const workDir = path.join(tmp, 'work');

  execSync(`git init --bare --initial-branch=main ${bareDir}`, { stdio: 'pipe' });
  execSync(`git clone ${bareDir} ${workDir}`, { stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: workDir, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: workDir, stdio: 'pipe' });

  fs.writeFileSync(path.join(workDir, 'base.txt'), 'base\n');
  execSync('git add base.txt', { cwd: workDir, stdio: 'pipe' });
  execSync('git commit -m "initial"', { cwd: workDir, stdio: 'pipe' });
  execSync('git push origin main', { cwd: workDir, stdio: 'pipe' });

  execSync('git checkout -b dev', { cwd: workDir, stdio: 'pipe' });
  fs.writeFileSync(path.join(workDir, 'feature.txt'), 'feature\n');
  execSync('git add feature.txt', { cwd: workDir, stdio: 'pipe' });
  execSync('git commit -m "slice 50: feature (slice 50)"', { cwd: workDir, stdio: 'pipe' });
  execSync('git push origin dev', { cwd: workDir, stdio: 'pipe' });
  const devSha = execSync('git rev-parse dev', { cwd: workDir, encoding: 'utf-8' }).trim();
  execSync('git checkout main', { cwd: workDir, stdio: 'pipe' });

  const bridgeStateDir = path.join(workDir, 'bridge', 'state');
  fs.mkdirSync(bridgeStateDir, { recursive: true });

  const scriptsDir = path.join(workDir, 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.writeFileSync(path.join(scriptsDir, 'unlock-main.sh'), '#!/bin/bash\necho ok\n');
  fs.writeFileSync(path.join(scriptsDir, 'lock-main.sh'), '#!/bin/bash\necho ok\n');

  const branchStatePath = path.join(bridgeStateDir, 'branch-state.json');

  const commits = opts.emptyCommits ? [] : [{
    sha: devSha, slice_id: '50', title: 'feature', ts: new Date().toISOString(), is_pending_squash: false,
  }];

  fs.writeFileSync(branchStatePath, JSON.stringify({
    schema_version: 1,
    main: { tip_sha: null, tip_subject: null, tip_ts: null },
    dev: {
      tip_sha: devSha,
      tip_ts: new Date().toISOString(),
      commits_ahead_of_main: commits.length,
      commits,
      deferred_slices: [],
    },
    last_merge: null,
    gate: { status: 'GATE_RUNNING', current_run: { started_ts: new Date().toISOString(), snapshot_dev_tip_sha: devSha }, last_failure: null, last_pass: null },
  }, null, 2) + '\n');

  const mutexPath = path.join(bridgeStateDir, 'gate-running.json');
  fs.writeFileSync(mutexPath, JSON.stringify({
    schema_version: 1, started_ts: new Date().toISOString(), dev_tip_sha: devSha, bashir_pid: null, bashir_heartbeat_path: 'x',
  }) + '\n');

  const registerPath = path.join(workDir, 'bridge', 'register.jsonl');
  fs.writeFileSync(registerPath, '');

  _testSetProjectDir(workDir);
  _testSetRegisterFile(registerPath);
  telemetry.setRegisterPath(registerPath);

  return { repoDir: workDir, branchStatePath, registerPath, mutexPath, bareDir, cleanup: () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {} }, devSha };
}

// ---------------------------------------------------------------------------
console.log('\ndev-to-main-merge-fail.test.js (slice 269)\n');

test('no slices on dev: returns failure, emits gate-abort, releases mutex', () => {
  const { registerPath, cleanup } = setupTestRepo({ emptyCommits: true });
  try {
    const result = mergeDevToMain();
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, 'no_slices_on_dev');

    // gate-abort emitted
    const events = fs.readFileSync(registerPath, 'utf-8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
    const abort = events.find(e => e.event === 'gate-abort');
    assert.ok(abort, 'should emit gate-abort');
    assert.strictEqual(abort.reason, 'no-slices-on-dev');

    // Mutex released (verified via telemetry)
    const released = events.find(e => e.event === 'gate-mutex-released');
    assert.ok(released, 'gate-mutex-released should be emitted');
  } finally {
    cleanup();
  }
});

test('push reject: returns failure, emits gate-abort, releases mutex', () => {
  const { repoDir, bareDir, registerPath, mutexPath, cleanup, devSha } = setupTestRepo();
  try {
    // Make the bare repo reject pushes by installing a pre-receive hook
    const hookDir = path.join(bareDir, 'hooks');
    fs.mkdirSync(hookDir, { recursive: true });
    fs.writeFileSync(path.join(hookDir, 'pre-receive'), '#!/bin/bash\nexit 1\n');
    fs.chmodSync(path.join(hookDir, 'pre-receive'), 0o755);

    const result = mergeDevToMain();
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, 'push_rejected');

    // gate-abort emitted
    const events = fs.readFileSync(registerPath, 'utf-8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
    const abort = events.find(e => e.event === 'gate-abort');
    assert.ok(abort, 'should emit gate-abort on push reject');

    // Mutex released (verified via telemetry)
    const released = events.find(e => e.event === 'gate-mutex-released');
    assert.ok(released, 'gate-mutex-released should be emitted after push reject');

    // Main should not have advanced (we reset it)
    // After reset, main should be back at initial commit
    const mainTip = execSync('git log -1 --format=%s main', { cwd: repoDir, encoding: 'utf-8' }).trim();
    assert.strictEqual(mainTip, 'initial', 'main should be reset to pre-merge state');
  } finally {
    cleanup();
  }
});

test('lock is re-engaged (finally block) on merge-path failure', () => {
  const { repoDir, bareDir, registerPath, cleanup } = setupTestRepo();
  try {
    // Make the bare repo reject pushes
    const hookDir = path.join(bareDir, 'hooks');
    fs.mkdirSync(hookDir, { recursive: true });
    fs.writeFileSync(path.join(hookDir, 'pre-receive'), '#!/bin/bash\nexit 1\n');
    fs.chmodSync(path.join(hookDir, 'pre-receive'), 0o755);

    mergeDevToMain();

    // Lock-cycle relock should fire via the finally block
    const events = fs.readFileSync(registerPath, 'utf-8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
    const relocks = events.filter(e => e.event === 'lock-cycle' && e.cycle_phase === 'relock');
    assert.ok(relocks.length > 0, 'lock-cycle relock should fire on merge-path failure');
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
console.log('');
console.log(`  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
