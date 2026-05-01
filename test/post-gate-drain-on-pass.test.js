'use strict';

/**
 * post-gate-drain-on-pass.test.js — Slice 273
 *
 * With two slices in dev.deferred_slices, simulate post-gate drain;
 * verify both slices squash to dev in accepted_ts order, deferred_slices empties.
 *
 * Run: node test/post-gate-drain-on-pass.test.js
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
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'drain-pass-test-'));
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

  // Create slice/050 with a change
  execSync('git checkout -b slice/050', { cwd: workDir, stdio: 'pipe' });
  fs.writeFileSync(path.join(workDir, 'feat50.txt'), 'feature 50\n');
  execSync('git add feat50.txt', { cwd: workDir, stdio: 'pipe' });
  execSync('git commit -m "add feature 50"', { cwd: workDir, stdio: 'pipe' });

  // Create slice/051 from dev with a different change
  execSync('git checkout dev', { cwd: workDir, stdio: 'pipe' });
  execSync('git checkout -b slice/051', { cwd: workDir, stdio: 'pipe' });
  fs.writeFileSync(path.join(workDir, 'feat51.txt'), 'feature 51\n');
  execSync('git add feat51.txt', { cwd: workDir, stdio: 'pipe' });
  execSync('git commit -m "add feature 51"', { cwd: workDir, stdio: 'pipe' });

  // Ensure we're on dev
  execSync('git checkout dev', { cwd: workDir, stdio: 'pipe' });

  // Set up branch-state with two deferred slices (051 accepted before 050)
  fs.mkdirSync(stateDir, { recursive: true });
  const branchState = {
    gate: { status: 'IDLE' },
    dev: {
      tip_sha: null, tip_ts: null, commits_ahead_of_main: 0, commits: [], deferred_slices: [
        { slice_id: '051', accepted_ts: '2026-04-30T10:00:00Z' },
        { slice_id: '050', accepted_ts: '2026-04-30T09:00:00Z' },
      ],
    },
  };
  fs.writeFileSync(path.join(stateDir, 'branch-state.json'), JSON.stringify(branchState, null, 2));

  // Write ACCEPTED files for both slices (metadata source for readSliceMeta)
  for (const [id, title] of [['050', 'Feature 50'], ['051', 'Feature 51']]) {
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

  // Configure orchestrator
  fs.writeFileSync(regFile, '', 'utf8');
  _testSetRegisterFile(regFile);
  _testSetDirs(queueDir, stagedDir, trashDir);
  _testSetProjectDir(workDir);

  const cleanup = () => {
    fs.rmSync(tmp, { recursive: true, force: true });
  };

  return { tmp, workDir, queueDir, stateDir, regFile, cleanup };
}

function readRegEvents(regFile) {
  try {
    return fs.readFileSync(regFile, 'utf-8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  } catch (_) { return []; }
}

console.log('\npost-gate-drain-on-pass tests (slice 273)');

test('A — Drain squashes both deferred slices to dev in accepted_ts order', () => {
  const { workDir, stateDir, regFile, cleanup } = setupTestRepo();
  try {
    drainDeferredAfterGate();

    // Verify both slices landed on dev
    const devLog = execSync('git log --oneline dev', { cwd: workDir, encoding: 'utf-8' });
    assert.ok(devLog.includes('slice 050'), `dev log should contain slice 050: ${devLog}`);
    assert.ok(devLog.includes('slice 051'), `dev log should contain slice 051: ${devLog}`);

    // Verify order: 050 (earlier accepted_ts) should appear first in log (most recent last)
    const devLogLines = devLog.trim().split('\n');
    const idx050 = devLogLines.findIndex(l => l.includes('slice 050'));
    const idx051 = devLogLines.findIndex(l => l.includes('slice 051'));
    // In git log, most recent commit is first. 051 was drained second (later), so idx051 < idx050.
    assert.ok(idx051 < idx050, `Slice 051 should be more recent than 050 (drained second): 050@${idx050}, 051@${idx051}`);

    // Verify main is unchanged
    const mainLog = execSync('git log --oneline main', { cwd: workDir, encoding: 'utf-8' });
    assert.ok(!mainLog.includes('slice 050'), 'main should NOT contain slice 050');
    assert.ok(!mainLog.includes('slice 051'), 'main should NOT contain slice 051');

    // Verify deferred_slices is empty
    const state = JSON.parse(fs.readFileSync(path.join(stateDir, 'branch-state.json'), 'utf-8'));
    assert.strictEqual(state.dev.deferred_slices.length, 0, 'deferred_slices should be empty after drain');

    // Verify commits_ahead_of_main updated
    assert.strictEqual(state.dev.commits_ahead_of_main, 2, 'Should have 2 commits ahead of main');

    // Verify register events
    const events = readRegEvents(regFile);
    const squashEvents = events.filter(e => e.event === 'SLICE_SQUASHED_TO_DEV');
    assert.strictEqual(squashEvents.length, 2, 'Should have 2 SLICE_SQUASHED_TO_DEV events');

    // Verify gate.status transitioned to ACCUMULATING (was IDLE + commits on dev)
    assert.strictEqual(state.gate.status, 'ACCUMULATING', 'gate.status should be ACCUMULATING after drain with commits');
  } finally {
    cleanup();
  }
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
