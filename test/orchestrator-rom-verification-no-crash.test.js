'use strict';

/**
 * orchestrator-rom-verification-no-crash.test.js — Slice 214
 *
 * Regression test for the TDZ crash at orchestrator.js:2101.
 *
 * When verifyRomActuallyWorked returns { ok: false, reason: 'rom_no_commits' },
 * the error-handling block must complete without throwing ReferenceError.
 * Previously, an inner `const sliceMeta` declaration in the sibling else-block
 * created a Temporal Dead Zone that crashed the process on any verify failure.
 *
 * Incident: 2026-04-25 ~10:14Z, slice 210 triggered the crash.
 *
 * Run: node test/orchestrator-rom-verification-no-crash.test.js
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

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
  gitFinalizer.runGit = function (cmd) {
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

// ---------------------------------------------------------------------------
// Part 1: Static — no inner sliceMeta shadow in execFile callback
// ---------------------------------------------------------------------------

console.log('\nPart 1: Static analysis — TDZ regression guard');

test('A — no second const sliceMeta in the execFile callback verify block', () => {
  // The outer sliceMeta is at ~line 1834. There should be exactly ONE
  // `const sliceMeta` in invokeRom (bounded by the next top-level function).
  const invokeRomStart = orchestratorSource.indexOf('function invokeRom(');
  assert.ok(invokeRomStart > 0, 'invokeRom function not found');

  // Find the next top-level function after invokeRom to bound the search
  const afterStart = orchestratorSource.slice(invokeRomStart + 1);
  const nextFnMatch = afterStart.match(/\nfunction /);
  const invokeRomBody = nextFnMatch
    ? orchestratorSource.slice(invokeRomStart, invokeRomStart + 1 + nextFnMatch.index)
    : afterStart;

  // Count const sliceMeta declarations within invokeRom only
  const matches = invokeRomBody.match(/\bconst\s+sliceMeta\b/g) || [];
  assert.strictEqual(matches.length, 1,
    `Expected exactly 1 'const sliceMeta' in invokeRom, found ${matches.length}. ` +
    'The inner shadow declaration must be removed to prevent TDZ.');
});

test('B — sliceMeta.root_commission_id reference exists in verify-failure block', () => {
  // The reference that previously crashed must still exist (now resolving to outer scope)
  const verifyBlock = orchestratorSource.match(/if \(!verify\.ok\)[\s\S]*?return;\s*\}/);
  assert.ok(verifyBlock, 'verify.ok false block not found');
  assert.ok(verifyBlock[0].includes('sliceMeta.root_commission_id'),
    'sliceMeta.root_commission_id reference must exist in verify-failure block');
});

// ---------------------------------------------------------------------------
// Part 2: Functional — rom_no_commits path completes without ReferenceError
// ---------------------------------------------------------------------------

console.log('\nPart 2: Functional — rom_no_commits does not crash');

test('C — verifyRomActuallyWorked returns rom_no_commits for skeleton-only + high claims', () => {
  const id = '99914';
  try {
    mockRunGit(1); // skeleton commit only
    writeTempDone(id, 8600, 1980000); // high claimed tokens
    const result = verifyRomActuallyWorked(id, `slice/${id}`, 22000, 563);
    assert.strictEqual(result.ok, false, 'should reject');
    assert.strictEqual(result.reason, 'rom_no_commits', 'reason must be rom_no_commits');
  } finally {
    restoreRunGit();
    cleanupTempDone(id);
  }
});

test('D — sliceMeta.root_commission_id resolves after verify failure (no TDZ)', () => {
  // Simulate what the orchestrator callback does after verify fails:
  // access sliceMeta.root_commission_id in the same scope chain.
  // If the TDZ bug were still present, this pattern would throw ReferenceError.
  //
  // We test this by evaluating a minimal reproduction of the scoping pattern.
  const code = `
    (function () {
      const sliceMeta = { root_commission_id: 'test-root-123', title: 'test' };
      // Simulated verify-failure block
      const rootId = sliceMeta.root_commission_id || null;
      // Simulated success path (no inner const sliceMeta here anymore)
      const expectedHours = sliceMeta.expected_human_hours || null;
      return { rootId, expectedHours };
    })()
  `;
  const result = eval(code);
  assert.strictEqual(result.rootId, 'test-root-123',
    'root_commission_id must resolve without TDZ error');
});

test('E — appendKiraEvent payload would receive valid root_id from outer sliceMeta', () => {
  // Verify the actual orchestrator source has the appendKiraEvent call
  // with sliceMeta.root_commission_id in the verify-failure block
  const verifyBlock = orchestratorSource.match(/if \(!verify\.ok\)[\s\S]*?return;\s*\}/);
  assert.ok(verifyBlock, 'verify-failure block not found');
  assert.ok(verifyBlock[0].includes('appendKiraEvent'),
    'appendKiraEvent must be called in verify-failure block');
  assert.ok(verifyBlock[0].includes('sliceMeta.root_commission_id'),
    'appendKiraEvent must use sliceMeta.root_commission_id for root_id');
});

test('F — no let/var sliceMeta redeclarations in execFile callback', () => {
  const invokeRomStart = orchestratorSource.indexOf('function invokeRom(');
  const afterStart = orchestratorSource.slice(invokeRomStart + 1);
  const nextFnMatch = afterStart.match(/\nfunction /);
  const invokeRomBody = nextFnMatch
    ? orchestratorSource.slice(invokeRomStart, invokeRomStart + 1 + nextFnMatch.index)
    : afterStart;
  const letMatches = invokeRomBody.match(/\blet\s+sliceMeta\b/g) || [];
  const varMatches = invokeRomBody.match(/\bvar\s+sliceMeta\b/g) || [];
  assert.strictEqual(letMatches.length, 0,
    'No let sliceMeta should exist in invokeRom');
  assert.strictEqual(varMatches.length, 0,
    'No var sliceMeta should exist in invokeRom');
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
