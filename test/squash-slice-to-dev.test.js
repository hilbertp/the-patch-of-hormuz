'use strict';

/**
 * squash-slice-to-dev.test.js — Slice 266
 *
 * Tests for squashSliceToDev helper:
 *   A — Happy path: squash commit on dev with correct subject + trailers, branch-state updated, register event emitted
 *   B — Conflict path: returns { success: false, error: "conflict" }, no partial state
 *   C — Trailer format: machine-parseable Slice-Id and Slice-Branch lines
 *   D — Atomic-write usage: no direct fs.writeFile to branch-state.json in new code
 *
 * Run: node test/squash-slice-to-dev.test.js
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { execSync } = require('child_process');

const BRIDGE_DIR = path.join(__dirname, '..', 'bridge');
const { squashSliceToDev, _testSetProjectDir, _testSetRegisterFile } = require('../bridge/orchestrator');

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

/**
 * Creates a temporary bare+clone git repo with a dev branch and a slice branch.
 * Redirects orchestrator's PROJECT_DIR and REGISTER_FILE to the temp repo.
 * Returns { repoDir, cleanup }.
 */
function setupTestRepo(opts = {}) {
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'squash-test-'));
  const bareDir = path.join(tmp, 'bare.git');
  const workDir = path.join(tmp, 'work');

  // Create bare remote with main as default branch
  execSync(`git init --bare --initial-branch=main ${bareDir}`, { stdio: 'pipe' });

  // Clone it
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

  // Create slice branch from dev
  const sliceBranch = opts.sliceBranch || 'slice/042';
  execSync(`git checkout -b ${sliceBranch}`, { cwd: workDir, stdio: 'pipe' });

  if (opts.conflict) {
    // Make a conflicting change on dev
    execSync('git checkout dev', { cwd: workDir, stdio: 'pipe' });
    fs.writeFileSync(path.join(workDir, 'conflict.txt'), 'dev-version\n');
    execSync('git add conflict.txt', { cwd: workDir, stdio: 'pipe' });
    execSync('git commit -m "dev conflict"', { cwd: workDir, stdio: 'pipe' });
    execSync('git push origin dev', { cwd: workDir, stdio: 'pipe' });

    // Make conflicting change on slice
    execSync(`git checkout ${sliceBranch}`, { cwd: workDir, stdio: 'pipe' });
    fs.writeFileSync(path.join(workDir, 'conflict.txt'), 'slice-version\n');
    execSync('git add conflict.txt', { cwd: workDir, stdio: 'pipe' });
    execSync('git commit -m "slice conflict"', { cwd: workDir, stdio: 'pipe' });
  } else {
    // Normal: add a commit on the slice branch
    fs.writeFileSync(path.join(workDir, 'feature.txt'), 'new feature\n');
    execSync('git add feature.txt', { cwd: workDir, stdio: 'pipe' });
    execSync('git commit -m "slice work"', { cwd: workDir, stdio: 'pipe' });
  }

  // Set up bridge/state dir and branch-state.json in the work dir
  const bridgeStateDir = path.join(workDir, 'bridge', 'state');
  fs.mkdirSync(bridgeStateDir, { recursive: true });
  const branchStatePath = path.join(bridgeStateDir, 'branch-state.json');
  fs.writeFileSync(branchStatePath, JSON.stringify({
    schema_version: 1,
    main: { tip_sha: null, tip_subject: null, tip_ts: null },
    dev: { tip_sha: null, tip_ts: null, commits_ahead_of_main: 0, commits: [], deferred_slices: [] },
    last_merge: null,
    gate: { status: 'IDLE', current_run: null, last_failure: null, last_pass: null },
  }, null, 2) + '\n');

  // Set up register file
  const registerPath = path.join(workDir, 'bridge', 'register.jsonl');
  fs.writeFileSync(registerPath, '');

  // Redirect orchestrator to use temp repo
  _testSetProjectDir(workDir);
  _testSetRegisterFile(registerPath);

  function cleanup() {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  }

  return { repoDir: workDir, branchStatePath, registerPath, bareDir, cleanup, sliceBranch };
}

console.log('\n-- squashSliceToDev unit tests --');

// ---------------------------------------------------------------------------
// A — Happy path
// ---------------------------------------------------------------------------
test('A — happy path: squash commit on dev with correct subject, trailers, and state update', () => {
  const { repoDir, branchStatePath, registerPath, cleanup } = setupTestRepo();

  try {
    const result = squashSliceToDev('042', 'Test Feature', 'slice/042');

    assert.strictEqual(result.success, true, `Expected success, got: ${JSON.stringify(result)}`);
    assert.ok(result.dev_sha, 'Expected dev_sha in result');

    // Verify commit subject and trailers on dev
    const body = execSync('git log -1 --format=%B dev', { cwd: repoDir, encoding: 'utf-8' }).trim();
    const subject = body.split('\n')[0];
    assert.strictEqual(subject, 'slice 042: Test Feature');
    assert.ok(body.includes('Slice-Id: 042'), `Expected Slice-Id trailer in: ${body}`);
    assert.ok(body.includes('Slice-Branch: slice/042'), `Expected Slice-Branch trailer in: ${body}`);

    // Verify feature.txt is on dev
    const files = execSync('git ls-tree --name-only HEAD', { cwd: repoDir, encoding: 'utf-8' });
    assert.ok(files.includes('feature.txt'), 'feature.txt should be on dev after squash');

    // Verify branch-state was updated
    const updated = JSON.parse(fs.readFileSync(branchStatePath, 'utf-8'));
    assert.strictEqual(updated.dev.commits.length, 1);
    assert.strictEqual(updated.dev.commits[0].slice_id, '042');
    assert.strictEqual(updated.dev.commits[0].sha, result.dev_sha);
    assert.strictEqual(updated.dev.commits_ahead_of_main, 1);
    assert.strictEqual(updated.dev.tip_sha, result.dev_sha);

    // Verify register event was emitted
    const regContent = fs.readFileSync(registerPath, 'utf-8').trim();
    assert.ok(regContent.length > 0, 'Register file should not be empty');
    const regEntry = JSON.parse(regContent.split('\n').pop());
    assert.strictEqual(regEntry.event, 'SLICE_SQUASHED_TO_DEV');
    assert.strictEqual(regEntry.slice_id, '042');
    assert.strictEqual(regEntry.dev_tip_sha, result.dev_sha);
    assert.strictEqual(regEntry.squash_sha, result.dev_sha);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// B — Conflict path
// ---------------------------------------------------------------------------
test('B — conflict path: returns { success: false, error: "conflict" }, no partial state', () => {
  const { repoDir, branchStatePath, registerPath, cleanup } = setupTestRepo({ conflict: true });

  try {
    const result = squashSliceToDev('042', 'Test Feature', 'slice/042');

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, 'conflict');

    // Verify no partial state — dev should still be at its original tip
    const devLog = execSync('git log --oneline dev', { cwd: repoDir, encoding: 'utf-8' }).trim();
    assert.ok(devLog.includes('dev conflict'), 'dev should have its original commits');
    assert.ok(!devLog.includes('slice 042'), 'dev should NOT have any squash commit');

    // branch-state should be untouched
    const state = JSON.parse(fs.readFileSync(branchStatePath, 'utf-8'));
    assert.strictEqual(state.dev.commits.length, 0, 'No commits should be added to branch-state');
    assert.strictEqual(state.dev.commits_ahead_of_main, 0);

    // register should be empty (no event emitted for conflict)
    const reg = fs.readFileSync(registerPath, 'utf-8').trim();
    assert.strictEqual(reg, '', 'No register event should be emitted on conflict');
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// C — Trailer format
// ---------------------------------------------------------------------------
test('C — trailer format: Slice-Id and Slice-Branch are machine-parseable per ADR §8', () => {
  const { repoDir, cleanup } = setupTestRepo();

  try {
    const result = squashSliceToDev('042', 'Test Feature', 'slice/042');
    assert.strictEqual(result.success, true, `Expected success, got: ${JSON.stringify(result)}`);

    // Verify exact trailer format
    const body = execSync('git log -1 --format=%B dev', { cwd: repoDir, encoding: 'utf-8' }).trim();
    const lines = body.split('\n');

    // Find trailer lines
    const sliceIdLine = lines.find(l => l.startsWith('Slice-Id:'));
    const sliceBranchLine = lines.find(l => l.startsWith('Slice-Branch:'));

    assert.ok(sliceIdLine, 'Slice-Id trailer line must exist');
    assert.ok(sliceBranchLine, 'Slice-Branch trailer line must exist');

    // Exact format: no leading whitespace, no trailing whitespace
    assert.strictEqual(sliceIdLine, 'Slice-Id: 042', `Slice-Id format mismatch: "${sliceIdLine}"`);
    assert.strictEqual(sliceBranchLine, 'Slice-Branch: slice/042', `Slice-Branch format mismatch: "${sliceBranchLine}"`);

    // Trailers must be separated from subject by a blank line
    const subjectIdx = lines.findIndex(l => l.startsWith('slice 042:'));
    const sliceIdIdx = lines.indexOf(sliceIdLine);
    assert.ok(subjectIdx >= 0, 'Subject line must exist');
    assert.ok(sliceIdIdx > subjectIdx + 1, 'Trailers must be separated from subject by at least one blank line');

    // Verify blank line exists between subject and trailers
    const betweenLines = lines.slice(subjectIdx + 1, sliceIdIdx);
    assert.ok(betweenLines.some(l => l.trim() === ''), 'Must have blank line between subject and trailers');
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// D — Atomic-write usage
// ---------------------------------------------------------------------------
test('D — atomic-write usage: no direct fs.writeFile to branch-state.json in new squashSliceToDev code', () => {
  const orchestratorSrc = fs.readFileSync(
    path.join(BRIDGE_DIR, 'orchestrator.js'),
    'utf-8'
  );

  // Extract just the squashSliceToDev function
  const funcStart = orchestratorSrc.indexOf('function squashSliceToDev(');
  assert.ok(funcStart > -1, 'squashSliceToDev function must exist in orchestrator.js');

  // Find the end of the function by tracking brace depth
  let depth = 0;
  let funcEnd = -1;
  let started = false;
  for (let i = funcStart; i < orchestratorSrc.length; i++) {
    if (orchestratorSrc[i] === '{') { depth++; started = true; }
    if (orchestratorSrc[i] === '}') { depth--; }
    if (started && depth === 0) { funcEnd = i + 1; break; }
  }
  assert.ok(funcEnd > funcStart, 'Could not find end of squashSliceToDev function');

  const funcBody = orchestratorSrc.slice(funcStart, funcEnd);

  // Check no direct fs.writeFile or fs.writeFileSync to branch-state
  const hasDirectWrite = /fs\.writeFileSync?\s*\(\s*.*branch.state/i.test(funcBody);
  assert.ok(!hasDirectWrite, 'squashSliceToDev must NOT use fs.writeFile for branch-state.json — use writeJsonAtomic');

  // Verify writeJsonAtomic IS used
  assert.ok(funcBody.includes('writeJsonAtomic'), 'squashSliceToDev must use writeJsonAtomic for branch-state.json writes');
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
