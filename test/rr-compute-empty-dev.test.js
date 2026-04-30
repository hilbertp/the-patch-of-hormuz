'use strict';

/**
 * rr-compute-empty-dev.test.js — Slice 270
 *
 * Verifies that computeRR() returns rr=0, band=green when
 * branch-state.dev.commits is empty.
 *
 * Run: node test/rr-compute-empty-dev.test.js
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const { computeRR, _testSetPaths } = require('../bridge/rr-compute');

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

const TEST_DIR = fs.mkdtempSync(path.join(require('os').tmpdir(), 'rr-empty-'));
const BRANCH_STATE_PATH = path.join(TEST_DIR, 'branch-state.json');
const REGISTER_PATH = path.join(TEST_DIR, 'register.jsonl');

function cleanup() {
  try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch (_) {}
}

console.log('\n-- rr-compute-empty-dev tests --');

// ---------------------------------------------------------------------------
// 1. Empty dev.commits → rr=0, band=green
// ---------------------------------------------------------------------------
test('empty dev.commits yields rr=0 band=green', () => {
  fs.writeFileSync(BRANCH_STATE_PATH, JSON.stringify({
    schema_version: 1,
    main: { tip_sha: 'abc123', tip_subject: 'initial', tip_ts: '2026-01-01T00:00:00Z' },
    dev: { tip_sha: 'abc123', tip_ts: '2026-01-01T00:00:00Z', commits_ahead_of_main: 0, commits: [], deferred_slices: [] },
    last_merge: null,
    gate: { status: 'IDLE', current_run: null, last_failure: null, last_pass: null },
  }, null, 2) + '\n');

  fs.writeFileSync(REGISTER_PATH, '');

  _testSetPaths({ branchStatePath: BRANCH_STATE_PATH, registerPath: REGISTER_PATH });

  const result = computeRR();
  assert.strictEqual(result.rr, 0, `Expected rr=0, got ${result.rr}`);
  assert.strictEqual(result.band, 'green', `Expected band=green, got ${result.band}`);
  assert.strictEqual(result.inputs.slice_pressure, 0);
  assert.strictEqual(result.inputs.surface_volatility, 0);
  assert.strictEqual(result.inputs.ac_coverage_gap, 0);
});

// ---------------------------------------------------------------------------
// 2. Missing branch-state.json → rr=0, band=green (graceful fallback)
// ---------------------------------------------------------------------------
test('missing branch-state.json yields rr=0 band=green', () => {
  _testSetPaths({ branchStatePath: path.join(TEST_DIR, 'nonexistent.json') });

  const result = computeRR();
  assert.strictEqual(result.rr, 0);
  assert.strictEqual(result.band, 'green');
});

cleanup();

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
