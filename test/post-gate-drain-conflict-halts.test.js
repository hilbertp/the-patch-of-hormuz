'use strict';

/**
 * post-gate-drain-conflict-halts.test.js — Slice 273
 *
 * With three deferred slices where the second has a conflict; verify first
 * squashes, second halts with error, third stays in deferred_slices.
 *
 * Run: node test/post-gate-drain-conflict-halts.test.js
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
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'drain-conflict-test-'));
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

  // Slice 070: clean, no conflict
  execSync('git checkout -b slice/070 dev', { cwd: workDir, stdio: 'pipe' });
  fs.writeFileSync(path.join(workDir, 'feat70.txt'), 'feature 70\n');
  execSync('git add feat70.txt', { cwd: workDir, stdio: 'pipe' });
  execSync('git commit -m "add feature 70"', { cwd: workDir, stdio: 'pipe' });

  // Slice 071: will conflict with dev (after slice 070 lands)
  execSync('git checkout dev', { cwd: workDir, stdio: 'pipe' });
  execSync('git checkout -b slice/071', { cwd: workDir, stdio: 'pipe' });
  // Write a file that will conflict when merged after slice 070 modifies dev
  fs.writeFileSync(path.join(workDir, 'conflict.txt'), 'slice-071-version\n');
  execSync('git add conflict.txt', { cwd: workDir, stdio: 'pipe' });
  execSync('git commit -m "add conflicting feature 71"', { cwd: workDir, stdio: 'pipe' });

  // Now add the same file to dev so there's a conflict when slice/071 tries to merge
  execSync('git checkout dev', { cwd: workDir, stdio: 'pipe' });
  fs.writeFileSync(path.join(workDir, 'conflict.txt'), 'dev-version-conflicts\n');
  execSync('git add conflict.txt', { cwd: workDir, stdio: 'pipe' });
  execSync('git commit -m "dev: add conflict.txt"', { cwd: workDir, stdio: 'pipe' });
  execSync('git push origin dev', { cwd: workDir, stdio: 'pipe' });

  // Slice 072: clean, no conflict
  execSync('git checkout -b slice/072 dev', { cwd: workDir, stdio: 'pipe' });
  fs.writeFileSync(path.join(workDir, 'feat72.txt'), 'feature 72\n');
  execSync('git add feat72.txt', { cwd: workDir, stdio: 'pipe' });
  execSync('git commit -m "add feature 72"', { cwd: workDir, stdio: 'pipe' });

  execSync('git checkout dev', { cwd: workDir, stdio: 'pipe' });

  // Set up branch-state with three deferred slices in order
  fs.mkdirSync(stateDir, { recursive: true });
  const branchState = {
    gate: { status: 'IDLE' },
    dev: {
      tip_sha: null, tip_ts: null, commits_ahead_of_main: 0, commits: [], deferred_slices: [
        { slice_id: '070', accepted_ts: '2026-04-30T09:00:00Z' },
        { slice_id: '071', accepted_ts: '2026-04-30T09:01:00Z' },
        { slice_id: '072', accepted_ts: '2026-04-30T09:02:00Z' },
      ],
    },
  };
  fs.writeFileSync(path.join(stateDir, 'branch-state.json'), JSON.stringify(branchState, null, 2));

  // Write ACCEPTED files
  for (const [id, title] of [['070', 'Feature 70'], ['071', 'Feature 71'], ['072', 'Feature 72']]) {
    const content = [
      '---',
      `id: "${id}"`,
      `title: "${title}"`,
      `branch: "slice/${id}"`,
      'status: "ACCEPTED"',
      '---',
      '',
      `## Slice ${id}`,
    ].join('\n');
    fs.writeFileSync(path.join(queueDir, `${id}-ACCEPTED.md`), content);
  }

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

function readRegEvents(regFile) {
  try {
    return fs.readFileSync(regFile, 'utf-8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  } catch (_) { return []; }
}

console.log('\npost-gate-drain-conflict-halts tests (slice 273)');

test('A — Conflict mid-drain: first squashes, second halts, third stays deferred', () => {
  const { workDir, stateDir, regFile, cleanup } = setupTestRepo();
  try {
    drainDeferredAfterGate();

    // Verify slice 070 landed on dev
    const devLog = execSync('git log --oneline dev', { cwd: workDir, encoding: 'utf-8' });
    assert.ok(devLog.includes('slice 070'), `dev log should contain slice 070: ${devLog}`);

    // Verify slice 071 did NOT land (conflict)
    assert.ok(!devLog.includes('slice 071'), `dev log should NOT contain slice 071: ${devLog}`);

    // Verify slice 072 did NOT land (halted after 071 conflict)
    assert.ok(!devLog.includes('slice 072'), `dev log should NOT contain slice 072: ${devLog}`);

    // Verify deferred_slices still has slices 071 and 072
    const state = JSON.parse(fs.readFileSync(path.join(stateDir, 'branch-state.json'), 'utf-8'));
    const remaining = state.dev.deferred_slices.map(e => e.slice_id);
    assert.ok(!remaining.includes('070'), 'Slice 070 should be removed from deferred');
    assert.ok(remaining.includes('071'), 'Slice 071 should remain deferred');
    assert.ok(remaining.includes('072'), 'Slice 072 should remain deferred');

    // Verify register: only slice 070 got SLICE_SQUASHED_TO_DEV
    const events = readRegEvents(regFile);
    const squashEvents = events.filter(e => e.event === 'SLICE_SQUASHED_TO_DEV');
    assert.strictEqual(squashEvents.length, 1, 'Should have exactly 1 SLICE_SQUASHED_TO_DEV');
    assert.strictEqual(squashEvents[0].slice_id, '070', 'Only slice 070 should be squashed');
  } finally {
    cleanup();
  }
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
