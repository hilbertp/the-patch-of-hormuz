'use strict';

/**
 * accept-and-merge-squash-to-dev.test.js — Slice 273
 *
 * With gate.status === "IDLE", accept a slice; verify squashSliceToDev was
 * called, slice landed on dev with correct trailers, main is unchanged.
 *
 * Run: node test/accept-and-merge-squash-to-dev.test.js
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { execSync } = require('child_process');

const {
  acceptAndMerge,
  squashSliceToDev,
  _testSetRegisterFile,
  _testSetDirs,
  _testSetProjectDir,
} = require('../bridge/orchestrator');

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

function setupTestRepo() {
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'squash-accept-test-'));
  const bareDir = path.join(tmp, 'bare.git');
  const workDir = path.join(tmp, 'work');
  const queueDir = path.join(tmp, 'queue');
  const stagedDir = path.join(tmp, 'staged');
  const trashDir = path.join(tmp, 'trash');
  const regFile = path.join(tmp, 'register.jsonl');
  const stateDir = path.join(workDir, 'bridge', 'state');

  fs.mkdirSync(queueDir, { recursive: true });
  fs.mkdirSync(stagedDir, { recursive: true });
  fs.mkdirSync(trashDir, { recursive: true });

  // Create bare remote
  execSync(`git init --bare --initial-branch=main ${bareDir}`, { stdio: 'pipe' });
  execSync(`git clone ${bareDir} ${workDir}`, { stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: workDir, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: workDir, stdio: 'pipe' });

  // Initial commit on main
  fs.writeFileSync(path.join(workDir, 'base.txt'), 'base\n');
  execSync('git add base.txt', { cwd: workDir, stdio: 'pipe' });
  execSync('git commit -m "initial"', { cwd: workDir, stdio: 'pipe' });
  execSync('git push origin main', { cwd: workDir, stdio: 'pipe' });

  // Create dev branch
  execSync('git checkout -b dev', { cwd: workDir, stdio: 'pipe' });
  execSync('git push origin dev', { cwd: workDir, stdio: 'pipe' });

  // Create slice branch with a change
  const sliceBranch = 'slice/042';
  execSync(`git checkout -b ${sliceBranch}`, { cwd: workDir, stdio: 'pipe' });
  fs.writeFileSync(path.join(workDir, 'feature.txt'), 'new feature\n');
  execSync('git add feature.txt', { cwd: workDir, stdio: 'pipe' });
  execSync('git commit -m "add feature"', { cwd: workDir, stdio: 'pipe' });

  // Ensure we're on dev
  execSync('git checkout dev', { cwd: workDir, stdio: 'pipe' });

  // Set up branch-state.json
  fs.mkdirSync(stateDir, { recursive: true });
  const branchState = {
    gate: { status: 'IDLE' },
    dev: { tip_sha: null, tip_ts: null, commits_ahead_of_main: 0, commits: [], deferred_slices: [] },
  };
  fs.writeFileSync(path.join(stateDir, 'branch-state.json'), JSON.stringify(branchState, null, 2));

  // Ensure gate-running.json does NOT exist (no gate running)
  try { fs.unlinkSync(path.resolve(__dirname, '..', 'bridge', 'state', 'gate-running.json')); } catch (_) {}

  // Write EVALUATING file
  const evalContent = [
    '---',
    'id: "042"',
    'title: "Test slice 042"',
    'branch: "slice/042"',
    'status: "EVALUATING"',
    '---',
    '',
    '## Body',
  ].join('\n');
  fs.writeFileSync(path.join(queueDir, '042-EVALUATING.md'), evalContent);

  // Configure orchestrator
  fs.writeFileSync(regFile, '', 'utf8');
  _testSetRegisterFile(regFile);
  _testSetDirs(queueDir, stagedDir, trashDir);
  _testSetProjectDir(workDir);

  const cleanup = () => {
    fs.rmSync(tmp, { recursive: true, force: true });
  };

  return { tmp, workDir, queueDir, stateDir, regFile, sliceBranch, cleanup };
}

function readRegEvents(regFile) {
  try {
    return fs.readFileSync(regFile, 'utf-8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  } catch (_) { return []; }
}

console.log('\naccept-and-merge-squash-to-dev tests (slice 273)');

test('A — IDLE gate: squashSliceToDev called and slice lands on dev', () => {
  const { workDir, queueDir, stateDir, regFile, cleanup } = setupTestRepo();
  try {
    const evalPath = path.join(queueDir, '042-EVALUATING.md');
    const result = acceptAndMerge('042', evalPath, 'slice/042', 'Test slice 042');

    assert.strictEqual(result.success, true, 'acceptAndMerge should succeed');
    assert.ok(result.sha, 'Should return a sha');
    assert.ok(!result.deferred, 'Should not be deferred');

    // Verify slice is on dev
    const devLog = execSync('git log --oneline dev', { cwd: workDir, encoding: 'utf-8' });
    assert.ok(devLog.includes('slice 042'), `dev log should contain slice commit: ${devLog}`);

    // Verify main is unchanged (only initial commit)
    const mainLog = execSync('git log --oneline main', { cwd: workDir, encoding: 'utf-8' });
    assert.ok(!mainLog.includes('slice 042'), `main should NOT contain slice commit: ${mainLog}`);

    // Verify trailers in commit message
    const devMsg = execSync('git log -1 --format=%B dev', { cwd: workDir, encoding: 'utf-8' });
    assert.ok(devMsg.includes('Slice-Id: 042'), 'Commit should have Slice-Id trailer');
    assert.ok(devMsg.includes('Slice-Branch: slice/042'), 'Commit should have Slice-Branch trailer');

    // Verify ACCEPTED file exists
    assert.ok(fs.existsSync(path.join(queueDir, '042-ACCEPTED.md')), 'ACCEPTED file should exist');

    // Verify register has SLICE_SQUASHED_TO_DEV event
    const events = readRegEvents(regFile);
    const squashEvent = events.find(e => e.event === 'SLICE_SQUASHED_TO_DEV');
    assert.ok(squashEvent, 'Register should have SLICE_SQUASHED_TO_DEV event');

    // Verify branch-state updated
    const state = JSON.parse(fs.readFileSync(path.join(stateDir, 'branch-state.json'), 'utf-8'));
    assert.ok(state.dev.commits_ahead_of_main > 0, 'dev should have commits ahead of main');
  } finally {
    cleanup();
  }
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
