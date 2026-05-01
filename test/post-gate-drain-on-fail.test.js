'use strict';

/**
 * post-gate-drain-on-fail.test.js — Slice 273
 *
 * Same setup as drain-on-pass but with releaseGateMutex("regression-fail");
 * verify drain still runs (deferred slices land on dev).
 *
 * Run: node test/post-gate-drain-on-fail.test.js
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { execSync } = require('child_process');

const {
  drainDeferredAfterGate,
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
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'drain-fail-test-'));
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

  // Create slice/060 with a change
  execSync('git checkout -b slice/060', { cwd: workDir, stdio: 'pipe' });
  fs.writeFileSync(path.join(workDir, 'feat60.txt'), 'feature 60\n');
  execSync('git add feat60.txt', { cwd: workDir, stdio: 'pipe' });
  execSync('git commit -m "add feature 60"', { cwd: workDir, stdio: 'pipe' });

  execSync('git checkout dev', { cwd: workDir, stdio: 'pipe' });

  // Set up branch-state with GATE_FAILED and one deferred slice
  fs.mkdirSync(stateDir, { recursive: true });
  const branchState = {
    gate: { status: 'GATE_FAILED', last_failure: { ts: '2026-04-30T10:00:00Z' } },
    dev: {
      tip_sha: null, tip_ts: null, commits_ahead_of_main: 0, commits: [], deferred_slices: [
        { slice_id: '060', accepted_ts: '2026-04-30T09:00:00Z' },
      ],
    },
  };
  fs.writeFileSync(path.join(stateDir, 'branch-state.json'), JSON.stringify(branchState, null, 2));

  // Write ACCEPTED file
  const content = [
    '---',
    'id: "060"',
    'title: "Feature 60"',
    'branch: "slice/060"',
    'status: "ACCEPTED"',
    '---',
    '',
    '## Slice 060',
  ].join('\n');
  fs.writeFileSync(path.join(queueDir, '060-ACCEPTED.md'), content);

  // Ensure no gate-running.json
  try { fs.unlinkSync(path.resolve(__dirname, '..', 'bridge', 'state', 'gate-running.json')); } catch (_) {}

  fs.writeFileSync(regFile, '', 'utf8');
  _testSetRegisterFile(regFile);
  _testSetDirs(queueDir, stagedDir, trashDir);
  _testSetProjectDir(workDir);

  const cleanup = () => {
    fs.rmSync(tmp, { recursive: true, force: true });
  };

  return { tmp, workDir, stateDir, regFile, cleanup };
}

console.log('\npost-gate-drain-on-fail tests (slice 273)');

test('A — Drain on regression-fail: deferred slices still land on dev, gate stays GATE_FAILED', () => {
  const { workDir, stateDir, regFile, cleanup } = setupTestRepo();
  try {
    drainDeferredAfterGate();

    // Verify slice landed on dev
    const devLog = execSync('git log --oneline dev', { cwd: workDir, encoding: 'utf-8' });
    assert.ok(devLog.includes('slice 060'), `dev log should contain slice 060: ${devLog}`);

    // Verify deferred_slices is empty
    const state = JSON.parse(fs.readFileSync(path.join(stateDir, 'branch-state.json'), 'utf-8'));
    assert.strictEqual(state.dev.deferred_slices.length, 0, 'deferred_slices should be empty');

    // Verify gate.status stays GATE_FAILED (not IDLE, so no transition to ACCUMULATING)
    assert.strictEqual(state.gate.status, 'GATE_FAILED', 'gate.status should stay GATE_FAILED');
  } finally {
    cleanup();
  }
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
