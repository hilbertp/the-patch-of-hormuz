'use strict';

/**
 * rom-verification.test.js — Slice 212
 *
 * Tests for verifyRomActuallyWorked():
 *   A — happy path: 3 commits, reasonable metrics → { ok: true }
 *   B — no commits past skeleton, high claims → { ok: false, reason: 'rom_no_commits' }
 *   C — metrics divergence only (commits exist) → { ok: true } (soft flag)
 *   D — both divergences (no commits + high claims) → { ok: false, reason: 'rom_no_commits' }
 *   E — short legit work: 1 commit, small claim → { ok: true }
 *   F — skeleton-only + no claims: 1 commit, low tokens → { ok: true }
 *
 * Also verifies:
 *   - writeErrorFile handles 'rom_no_commits' and 'metrics_divergence' reasons
 *   - invokeRom calls verifyRomActuallyWorked before DONE rename
 *   - verifyRomActuallyWorked is exported
 *
 * Run: node test/rom-verification.test.js
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const os = require('os');

const REPO_ROOT = path.resolve(__dirname, '..');
const BRIDGE_DIR = path.join(REPO_ROOT, 'bridge');
const QUEUE_DIR = path.join(BRIDGE_DIR, 'queue');

const orchestratorSource = fs.readFileSync(
  path.join(BRIDGE_DIR, 'orchestrator.js'),
  'utf-8'
);

const gitFinalizer = require('../bridge/git-finalizer');
const { verifyRomActuallyWorked } = require('../bridge/orchestrator.js');

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
  }
}

// ---------------------------------------------------------------------------
// Mock infrastructure
// ---------------------------------------------------------------------------

const originalRunGit = gitFinalizer.runGit;

function mockRunGit(commitCount) {
  gitFinalizer.runGit = function (cmd, opts) {
    if (cmd.includes('rev-list') && cmd.includes('^main --count')) {
      return String(commitCount) + '\n';
    }
    return '';
  };
}

function restoreRunGit() {
  gitFinalizer.runGit = originalRunGit;
}

function writeTempDone(id, tokensOut, elapsedMs) {
  const content = [
    '---',
    `id: "${id}"`,
    'status: DONE',
    `tokens_out: ${tokensOut}`,
    `elapsed_ms: ${elapsedMs}`,
    `tokens_in: ${tokensOut}`,
    'estimated_human_hours: 1.0',
    'compaction_occurred: false',
    '---',
    '',
    '## Work done',
    'Test content.',
  ].join('\n');
  fs.writeFileSync(path.join(QUEUE_DIR, `${id}-DONE.md`), content);
}

function cleanupTempDone(id) {
  try { fs.unlinkSync(path.join(QUEUE_DIR, `${id}-DONE.md`)); } catch (_) {}
}

// Use unique IDs to avoid collisions
const TEST_IDS = {
  A: '99901',
  B: '99902',
  C: '99903',
  D: '99904',
  E: '99905',
  F: '99906',
};

// ---------------------------------------------------------------------------
// Part 1: Static analysis
// ---------------------------------------------------------------------------

console.log('\nPart 1: Static analysis — function existence and structure');

test('verifyRomActuallyWorked function exists', () => {
  assert.ok(
    /function verifyRomActuallyWorked\(id, branchName, actualDurationMs, actualTokensOut\)/.test(orchestratorSource),
    'verifyRomActuallyWorked(id, branchName, actualDurationMs, actualTokensOut) not found'
  );
});

test('verifyRomActuallyWorked is exported', () => {
  assert.strictEqual(typeof verifyRomActuallyWorked, 'function',
    'verifyRomActuallyWorked should be exported from orchestrator.js');
});

test('invokeRom calls verifyRomActuallyWorked before DONE event', () => {
  const verifyIdx = orchestratorSource.indexOf('verifyRomActuallyWorked(id, sliceBranch');
  const doneEventIdx = orchestratorSource.indexOf("registerEvent(id, 'DONE'");
  assert.ok(verifyIdx > 0, 'verifyRomActuallyWorked call not found in invokeRom');
  assert.ok(doneEventIdx > 0, "registerEvent(id, 'DONE') not found");
  assert.ok(verifyIdx < doneEventIdx, 'verifyRomActuallyWorked must come before DONE registerEvent');
});

test('writeErrorFile handles rom_no_commits reason', () => {
  assert.ok(
    orchestratorSource.includes("reason === 'rom_no_commits'"),
    'writeErrorFile must handle rom_no_commits reason'
  );
  assert.ok(
    orchestratorSource.includes('The report is fabricated'),
    'rom_no_commits detail text should mention fabricated report'
  );
});

test('writeErrorFile handles metrics_divergence reason', () => {
  assert.ok(
    orchestratorSource.includes("reason === 'metrics_divergence'"),
    'writeErrorFile must handle metrics_divergence reason'
  );
});

test('verification failure writes ERROR and returns early (no DONE)', () => {
  // In the verify.ok === false block, we should see writeErrorFile + return
  const verifyBlock = orchestratorSource.match(/if \(!verify\.ok\)[\s\S]*?return;\s*\}/);
  assert.ok(verifyBlock, 'verify.ok false block with return not found');
  assert.ok(verifyBlock[0].includes('writeErrorFile'), 'verify failure must call writeErrorFile');
  assert.ok(verifyBlock[0].includes("registerEvent(id, 'ERROR'"), 'verify failure must emit ERROR event');
});

// ---------------------------------------------------------------------------
// Part 2: Functional tests (with mocked git)
// ---------------------------------------------------------------------------

console.log('\nPart 2: Functional tests — verifyRomActuallyWorked');

test('Test A — happy path: 3 commits, reasonable metrics', () => {
  const id = TEST_IDS.A;
  try {
    mockRunGit(3);
    writeTempDone(id, 5000, 300000);
    const result = verifyRomActuallyWorked(id, `slice/${id}`, 280000, 4500);
    assert.deepStrictEqual(result, { ok: true });
  } finally {
    restoreRunGit();
    cleanupTempDone(id);
  }
});

test('Test B — no commits past skeleton, high claims → rom_no_commits', () => {
  const id = TEST_IDS.B;
  try {
    mockRunGit(1); // only skeleton commit
    writeTempDone(id, 8600, 1980000);
    const result = verifyRomActuallyWorked(id, `slice/${id}`, 22000, 563);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'rom_no_commits');
    assert.ok(result.detail.includes('8600'), 'detail should mention claimed tokens');
  } finally {
    restoreRunGit();
    cleanupTempDone(id);
  }
});

test('Test C — metrics divergence only (commits exist) → ok: true', () => {
  const id = TEST_IDS.C;
  try {
    mockRunGit(3); // 3 real commits
    writeTempDone(id, 50000, 600000);
    const result = verifyRomActuallyWorked(id, `slice/${id}`, 500000, 500);
    // Soft flag only — should still return ok: true because commits exist
    assert.deepStrictEqual(result, { ok: true });
  } finally {
    restoreRunGit();
    cleanupTempDone(id);
  }
});

test('Test D — both divergences (no commits + high claims) → rom_no_commits', () => {
  const id = TEST_IDS.D;
  try {
    mockRunGit(0); // zero commits
    writeTempDone(id, 50000, 1800000);
    const result = verifyRomActuallyWorked(id, `slice/${id}`, 15000, 200);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'rom_no_commits');
  } finally {
    restoreRunGit();
    cleanupTempDone(id);
  }
});

test('Test E — short legit work: 1 commit, small claim → ok: true', () => {
  const id = TEST_IDS.E;
  try {
    mockRunGit(1); // 1 commit (small fix)
    writeTempDone(id, 800, 60000);
    const result = verifyRomActuallyWorked(id, `slice/${id}`, 55000, 700);
    // 800 tokens claimed is ≤ 1000 threshold, so skeleton heuristic doesn't trigger
    assert.deepStrictEqual(result, { ok: true });
  } finally {
    restoreRunGit();
    cleanupTempDone(id);
  }
});

test('Test F — skeleton-only + no claims: low tokens → ok: true', () => {
  const id = TEST_IDS.F;
  try {
    mockRunGit(1); // only skeleton commit
    writeTempDone(id, 100, 30000);
    const result = verifyRomActuallyWorked(id, `slice/${id}`, 25000, 90);
    // 100 tokens claimed ≤ 1000 threshold → not flagged (small claim = small work)
    assert.deepStrictEqual(result, { ok: true });
  } finally {
    restoreRunGit();
    cleanupTempDone(id);
  }
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
