'use strict';

/**
 * dev-fast-forward.test.js — Slice 269
 *
 * Post-merge verification that dev's tip equals main's tip exactly
 * (ADR §1: dev is fast-forwarded to main after each successful gate).
 *
 * Run: node test/dev-fast-forward.test.js
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

function setupTestRepo(sliceIds) {
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ff269-'));
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
  for (const sid of sliceIds) {
    fs.writeFileSync(path.join(workDir, `s${sid}.txt`), `s${sid}\n`);
    execSync(`git add s${sid}.txt`, { cwd: workDir, stdio: 'pipe' });
    execSync(`git commit -m "slice ${sid}: work (slice ${sid})"`, { cwd: workDir, stdio: 'pipe' });
  }
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
  fs.writeFileSync(branchStatePath, JSON.stringify({
    schema_version: 1,
    main: { tip_sha: null, tip_subject: null, tip_ts: null },
    dev: {
      tip_sha: devSha, tip_ts: new Date().toISOString(),
      commits_ahead_of_main: sliceIds.length,
      commits: sliceIds.map(sid => ({
        sha: devSha, slice_id: sid, title: 'work', ts: new Date().toISOString(), is_pending_squash: false,
      })),
      deferred_slices: [],
    },
    last_merge: null,
    gate: { status: 'GATE_RUNNING', current_run: { started_ts: new Date().toISOString(), snapshot_dev_tip_sha: devSha }, last_failure: null, last_pass: null },
  }, null, 2) + '\n');

  fs.writeFileSync(path.join(bridgeStateDir, 'gate-running.json'), JSON.stringify({
    schema_version: 1, started_ts: new Date().toISOString(), dev_tip_sha: devSha, bashir_pid: null, bashir_heartbeat_path: 'x',
  }) + '\n');

  const registerPath = path.join(workDir, 'bridge', 'register.jsonl');
  fs.writeFileSync(registerPath, '');

  _testSetProjectDir(workDir);
  _testSetRegisterFile(registerPath);
  telemetry.setRegisterPath(registerPath);

  return { repoDir: workDir, branchStatePath, cleanup: () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {} } };
}

// ---------------------------------------------------------------------------
console.log('\ndev-fast-forward.test.js (slice 269)\n');

test('post-merge: git rev-parse dev == git rev-parse main (local)', () => {
  const { repoDir, cleanup } = setupTestRepo(['60', '61']);
  try {
    const result = mergeDevToMain();
    assert.ok(result.success);

    const mainSha = execSync('git rev-parse main', { cwd: repoDir, encoding: 'utf-8' }).trim();
    const devSha = execSync('git rev-parse dev', { cwd: repoDir, encoding: 'utf-8' }).trim();
    assert.strictEqual(devSha, mainSha, 'dev tip should equal main tip after fast-forward');
  } finally {
    cleanup();
  }
});

test('post-merge: origin/dev == origin/main (remote)', () => {
  const { repoDir, cleanup } = setupTestRepo(['70']);
  try {
    const result = mergeDevToMain();
    assert.ok(result.success);

    execSync('git fetch origin', { cwd: repoDir, stdio: 'pipe' });
    const originMain = execSync('git rev-parse origin/main', { cwd: repoDir, encoding: 'utf-8' }).trim();
    const originDev = execSync('git rev-parse origin/dev', { cwd: repoDir, encoding: 'utf-8' }).trim();
    assert.strictEqual(originDev, originMain, 'origin/dev should equal origin/main');
  } finally {
    cleanup();
  }
});

test('branch-state dev.tip_sha matches main.tip_sha after merge', () => {
  const { branchStatePath, cleanup } = setupTestRepo(['80', '81', '82']);
  try {
    const result = mergeDevToMain();
    assert.ok(result.success);

    const state = JSON.parse(fs.readFileSync(branchStatePath, 'utf-8'));
    assert.strictEqual(state.dev.tip_sha, state.main.tip_sha, 'branch-state dev.tip_sha should equal main.tip_sha');
    assert.strictEqual(state.dev.tip_sha, result.merge_sha, 'both should equal merge_sha');
  } finally {
    cleanup();
  }
});

test('dev is not deleted — still exists as a branch', () => {
  const { repoDir, cleanup } = setupTestRepo(['90']);
  try {
    mergeDevToMain();

    const branches = execSync('git branch', { cwd: repoDir, encoding: 'utf-8' });
    assert.ok(branches.includes('dev'), 'dev branch should still exist');
  } finally {
    cleanup();
  }
});

test('with multiple slices: dev == main after fast-forward', () => {
  const { repoDir, cleanup } = setupTestRepo(['1', '2', '3', '4', '5']);
  try {
    const result = mergeDevToMain();
    assert.ok(result.success);

    const mainSha = execSync('git rev-parse main', { cwd: repoDir, encoding: 'utf-8' }).trim();
    const devSha = execSync('git rev-parse dev', { cwd: repoDir, encoding: 'utf-8' }).trim();
    assert.strictEqual(devSha, mainSha, 'dev == main with 5 slices');
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
console.log('');
console.log(`  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
