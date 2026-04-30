'use strict';

/**
 * dev-to-main-merge-trailer.test.js — Slice 269
 *
 * Verifies the merge commit's Slices: trailer lists all batch slice IDs
 * in the machine-parseable format required by ADR §8.
 *
 * Run: node test/dev-to-main-merge-trailer.test.js
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
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'trailer269-'));
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
    fs.writeFileSync(path.join(workDir, `slice-${sid}.txt`), `feature ${sid}\n`);
    execSync(`git add slice-${sid}.txt`, { cwd: workDir, stdio: 'pipe' });
    execSync(`git commit -m "slice ${sid}: feature (slice ${sid})"`, { cwd: workDir, stdio: 'pipe' });
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
      tip_sha: devSha,
      tip_ts: new Date().toISOString(),
      commits_ahead_of_main: sliceIds.length,
      commits: sliceIds.map(sid => ({
        sha: devSha, slice_id: sid, title: `feature`, ts: new Date().toISOString(), is_pending_squash: false,
      })),
      deferred_slices: [],
    },
    last_merge: null,
    gate: { status: 'GATE_RUNNING', current_run: { started_ts: new Date().toISOString(), snapshot_dev_tip_sha: devSha }, last_failure: null, last_pass: null },
  }, null, 2) + '\n');

  // Mutex
  fs.writeFileSync(path.join(bridgeStateDir, 'gate-running.json'), JSON.stringify({
    schema_version: 1, started_ts: new Date().toISOString(), dev_tip_sha: devSha, bashir_pid: null, bashir_heartbeat_path: 'x',
  }) + '\n');

  const registerPath = path.join(workDir, 'bridge', 'register.jsonl');
  fs.writeFileSync(registerPath, '');

  _testSetProjectDir(workDir);
  _testSetRegisterFile(registerPath);
  telemetry.setRegisterPath(registerPath);

  return { repoDir: workDir, cleanup: () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {} } };
}

// ---------------------------------------------------------------------------
console.log('\ndev-to-main-merge-trailer.test.js (slice 269)\n');

test('merge commit has Slices: trailer with all batch IDs (2 slices)', () => {
  const { repoDir, cleanup } = setupTestRepo(['200', '201']);
  try {
    const result = mergeDevToMain();
    assert.ok(result.success);

    const msg = execSync(`git log -1 --format=%B ${result.merge_sha}`, { cwd: repoDir, encoding: 'utf-8' });
    const slicesLine = msg.split('\n').find(l => l.startsWith('Slices:'));
    assert.ok(slicesLine, 'commit message should contain a Slices: line');
    assert.strictEqual(slicesLine.trim(), 'Slices: 200,201', 'Slices trailer should list all IDs comma-separated');
  } finally {
    cleanup();
  }
});

test('merge commit has Slices: trailer with single slice', () => {
  const { repoDir, cleanup } = setupTestRepo(['42']);
  try {
    const result = mergeDevToMain();
    assert.ok(result.success);

    const msg = execSync(`git log -1 --format=%B ${result.merge_sha}`, { cwd: repoDir, encoding: 'utf-8' });
    const slicesLine = msg.split('\n').find(l => l.startsWith('Slices:'));
    assert.ok(slicesLine, 'commit message should contain a Slices: line');
    assert.strictEqual(slicesLine.trim(), 'Slices: 42');
  } finally {
    cleanup();
  }
});

test('merge commit subject follows expected format', () => {
  const { repoDir, cleanup } = setupTestRepo(['300', '301', '302']);
  try {
    const result = mergeDevToMain();
    assert.ok(result.success);

    const subject = execSync(`git log -1 --format=%s ${result.merge_sha}`, { cwd: repoDir, encoding: 'utf-8' }).trim();
    assert.ok(subject.startsWith('merge: dev gate batch'), `subject should start with "merge: dev gate batch", got: ${subject}`);
    assert.ok(subject.includes('slices 300..302'), `subject should include slice range, got: ${subject}`);
  } finally {
    cleanup();
  }
});

test('Slices trailer is parseable by splitting on comma', () => {
  const { repoDir, cleanup } = setupTestRepo(['10', '20', '30']);
  try {
    const result = mergeDevToMain();
    assert.ok(result.success);

    const msg = execSync(`git log -1 --format=%B ${result.merge_sha}`, { cwd: repoDir, encoding: 'utf-8' });
    const slicesLine = msg.split('\n').find(l => l.startsWith('Slices:'));
    const ids = slicesLine.replace('Slices:', '').trim().split(',').map(s => s.trim());
    assert.deepStrictEqual(ids, ['10', '20', '30'], 'parsed IDs should match input');
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
console.log('');
console.log(`  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
