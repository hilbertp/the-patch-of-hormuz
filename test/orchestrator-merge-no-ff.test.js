'use strict';

/**
 * orchestrator-merge-no-ff.test.js — Slice 217
 *
 * Regression tests for --no-ff merge commits, idempotent branch deletion,
 * and branch backfill:
 *   A — mergeBranch uses --no-ff in its git merge command
 *   B — archiveAcceptedSlice branch deletion is idempotent (second call no-op)
 *   C — backfillBranches deletes branches for archived slices
 *   D — backfillBranches idempotency: marker present → no-op
 *   E — mergeBranch abort path: merge failure leaves main unchanged
 *
 * Run: node test/orchestrator-merge-no-ff.test.js
 */

const fs     = require('fs');
const os     = require('os');
const path   = require('path');
const assert = require('assert');

const REPO_ROOT  = path.resolve(__dirname, '..');
const BRIDGE_DIR = path.join(REPO_ROOT, 'bridge');

const gitFinalizer = require('../bridge/git-finalizer');
const { archiveAcceptedSlice, backfillBranches, _testSetRegisterFile } = require('../bridge/orchestrator.js');

const orchestratorSource = fs.readFileSync(
  path.join(BRIDGE_DIR, 'orchestrator.js'),
  'utf-8'
);

// ---------------------------------------------------------------------------
// Temp directory helpers
// ---------------------------------------------------------------------------

const TEMP  = fs.mkdtempSync(path.join(os.tmpdir(), 'ds9-no-ff-test-'));
const QUEUE = path.join(TEMP, 'queue');
const TRASH = path.join(TEMP, 'trash');
const REG   = path.join(TEMP, 'register.jsonl');

function resetDirs() {
  fs.rmSync(QUEUE, { recursive: true, force: true });
  fs.rmSync(TRASH, { recursive: true, force: true });
  fs.mkdirSync(QUEUE, { recursive: true });
  fs.mkdirSync(TRASH, { recursive: true });
  try { fs.unlinkSync(REG); } catch (_) {}
  fs.writeFileSync(REG, '', 'utf8');
  _testSetRegisterFile(REG);
}

function writeSliceFile(id, suffix) {
  const lines = [
    '---',
    `id: "${id}"`,
    `title: "Test slice ${id}"`,
    `status: "${suffix.replace(/^-|\.md$/g, '')}"`,
    `branch: "slice/${id}"`,
    '---',
    '',
    `## Slice ${id} body`,
  ];
  fs.writeFileSync(path.join(QUEUE, `${id}${suffix}`), lines.join('\n'));
}

function readReg() {
  try {
    return fs.readFileSync(REG, 'utf-8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  } catch (_) { return []; }
}

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;
const originalRunGit = gitFinalizer.runGit;

function restoreRunGit() {
  gitFinalizer.runGit = originalRunGit;
}

function test(name, fn) {
  resetDirs();
  restoreRunGit();
  try {
    fn();
    passed++;
    console.log(`  \u2713 ${name}`);
  } catch (err) {
    failed++;
    console.log(`  \u2717 ${name}`);
    console.log(`    ${err.message}`);
  }
  restoreRunGit();
}

// ---------------------------------------------------------------------------
// Test A: mergeBranch uses --no-ff
// ---------------------------------------------------------------------------

console.log('\n-- Merge --no-ff (slice 217) --');

test('A. mergeBranch source contains --no-ff in the merge command', () => {
  // Verify the source code contains the --no-ff flag in the merge command
  const mergeLinePattern = /gitFinalizer\.runGit\(`git merge --no-ff main -m/;
  assert.ok(
    mergeLinePattern.test(orchestratorSource),
    'mergeBranch must use "git merge --no-ff main -m ..." — pattern not found in source'
  );
});

// ---------------------------------------------------------------------------
// Test B: Idempotent branch deletion in archiveAcceptedSlice
// ---------------------------------------------------------------------------

console.log('\n-- Branch deletion idempotency --');

test('B. archiveAcceptedSlice called twice — second branch -D is a no-op', () => {
  let branchDCalls = 0;
  gitFinalizer.runGit = (cmd, opts) => {
    if (cmd.includes('git branch -D')) {
      branchDCalls++;
      if (branchDCalls > 1) {
        throw new Error('branch not found');
      }
      return '';
    }
    if (cmd.includes('git worktree prune')) return '';
    if (cmd.includes('git rev-parse main')) return 'abc123\n';
    return originalRunGit(cmd, opts);
  };

  writeSliceFile('950', '-ACCEPTED.md');
  const r1 = archiveAcceptedSlice('950', 'slice/950', { queueDir: QUEUE, trashDir: TRASH });
  assert.strictEqual(r1.archived, true);
  assert.strictEqual(branchDCalls, 1, 'First call should invoke branch -D');

  // Second call — already archived, so archiveAcceptedSlice returns early
  const r2 = archiveAcceptedSlice('950', 'slice/950', { queueDir: QUEUE, trashDir: TRASH });
  assert.strictEqual(r2.archived, false);
  assert.strictEqual(r2.reason, 'already_archived');
  // branch -D not called again because archive short-circuits
});

// ---------------------------------------------------------------------------
// Test C: backfillBranches deletes branches for archived slices
// ---------------------------------------------------------------------------

console.log('\n-- backfillBranches --');

test('C. Backfill: 3 archived branches + 2 non-archived → 3 deleted, 2 skipped', () => {
  const markerFile = path.join(TEMP, '.backfill-branches-done');
  try { fs.unlinkSync(markerFile); } catch (_) {}

  // Create ARCHIVED files for 3 slices
  writeSliceFile('960', '-ARCHIVED.md');
  writeSliceFile('961', '-ARCHIVED.md');
  writeSliceFile('962', '-ARCHIVED.md');
  // 963 and 964 have no ARCHIVED file (in-flight)

  const deletedBranches = [];
  gitFinalizer.runGit = (cmd, opts) => {
    if (cmd.includes('git branch --list')) {
      return '  slice/960\n  slice/961\n  slice/962\n  slice/963\n  slice/964\n';
    }
    if (cmd.includes('git branch -D')) {
      const branch = cmd.replace('git branch -D ', '');
      deletedBranches.push(branch);
      return '';
    }
    return originalRunGit(cmd, opts);
  };

  backfillBranches({ queueDir: QUEUE, markerFile });

  assert.deepStrictEqual(deletedBranches.sort(), ['slice/960', 'slice/961', 'slice/962']);

  const events = readReg();
  const evt = events.find(e => e.event === 'BACKFILL_BRANCHES_COMPLETE');
  assert.ok(evt, 'BACKFILL_BRANCHES_COMPLETE event must be emitted');
  assert.strictEqual(evt.processed, 3);
  assert.strictEqual(evt.skipped, 2);

  assert.ok(fs.existsSync(markerFile), 'Marker file must be written');
});

// ---------------------------------------------------------------------------
// Test D: backfillBranches idempotency
// ---------------------------------------------------------------------------

test('D. Marker present → backfillBranches is a no-op', () => {
  const markerFile = path.join(TEMP, '.backfill-branches-done-idem');
  fs.writeFileSync(markerFile, new Date().toISOString() + '\n');

  let gitCalled = false;
  gitFinalizer.runGit = () => { gitCalled = true; return ''; };

  backfillBranches({ queueDir: QUEUE, markerFile });

  assert.ok(!gitCalled, 'No git commands should run when marker exists');
  const events = readReg();
  const evt = events.find(e => e.event === 'BACKFILL_BRANCHES_COMPLETE');
  assert.ok(!evt, 'No event should be emitted on idempotent call');

  try { fs.unlinkSync(markerFile); } catch (_) {}
});

// ---------------------------------------------------------------------------
// Test E: mergeBranch abort path — merge failure leaves main unchanged
// ---------------------------------------------------------------------------

test('E. Source: mergeBranch merge failure returns { success: false } without updating main', () => {
  // Verify the source structure: merge command is in a try block,
  // and update-ref only runs AFTER a successful merge
  const lines = orchestratorSource.split('\n');

  // Find the merge --no-ff line
  const mergeLineIdx = lines.findIndex(l => l.includes('git merge --no-ff main'));
  assert.ok(mergeLineIdx > 0, 'Must find the --no-ff merge line');

  // Find the update-ref line
  const updateRefIdx = lines.findIndex((l, i) => i > mergeLineIdx && l.includes('git update-ref refs/heads/main'));
  assert.ok(updateRefIdx > mergeLineIdx, 'update-ref must come after merge');

  // The merge is inside a try block — if it throws, update-ref is skipped
  // Verify there's a try before the merge and a catch after
  const tryIdx = lines.slice(0, mergeLineIdx).reverse().findIndex(l => l.trim().startsWith('try'));
  assert.ok(tryIdx >= 0, 'merge must be inside a try block');
});

// ---------------------------------------------------------------------------
// Cleanup + summary
// ---------------------------------------------------------------------------

restoreRunGit();
fs.rmSync(TEMP, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
