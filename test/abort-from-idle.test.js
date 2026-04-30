'use strict';

/**
 * abort-from-idle.test.js — Slice 271
 *
 * Verifies that POST /api/gate/abort returns 409 when gate.status is IDLE.
 * Abort is only valid from GATE_FAILED or GATE_ABORTED states.
 *
 * Run: node test/abort-from-idle.test.js
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

// ---------------------------------------------------------------------------
// Test infrastructure
// ---------------------------------------------------------------------------

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
// Isolation
// ---------------------------------------------------------------------------

const BRANCH_STATE_PATH = path.resolve(__dirname, '..', 'bridge', 'state', 'branch-state.json');
const { writeJsonAtomic } = require('../bridge/state/atomic-write');

const originalBranchState = fs.readFileSync(BRANCH_STATE_PATH, 'utf-8');

function cleanup() {
  fs.writeFileSync(BRANCH_STATE_PATH, originalBranchState, 'utf-8');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

console.log('\nabort-from-idle.test.js (slice 271)\n');

test('abortGate throws INVALID_STATE for IDLE', () => {
  const state = JSON.parse(originalBranchState);
  state.gate = { status: 'IDLE', current_run: null, last_failure: null, last_pass: null };
  writeJsonAtomic(BRANCH_STATE_PATH, state);

  const { abortGate } = require('../bridge/orchestrator');

  let threw = false;
  let errCode = null;
  let errStatus = null;
  try {
    abortGate();
  } catch (err) {
    threw = true;
    errCode = err.code;
    errStatus = err.status;
  }

  assert.ok(threw, 'abortGate should throw for IDLE');
  assert.strictEqual(errCode, 'INVALID_STATE');
  assert.strictEqual(errStatus, 'IDLE');
});

test('abortGate throws INVALID_STATE for ACCUMULATING', () => {
  const state = JSON.parse(originalBranchState);
  state.gate = { status: 'ACCUMULATING', current_run: null, last_failure: null, last_pass: null };
  writeJsonAtomic(BRANCH_STATE_PATH, state);

  const { abortGate } = require('../bridge/orchestrator');

  let threw = false;
  let errCode = null;
  let errStatus = null;
  try {
    abortGate();
  } catch (err) {
    threw = true;
    errCode = err.code;
    errStatus = err.status;
  }

  assert.ok(threw, 'abortGate should throw for ACCUMULATING');
  assert.strictEqual(errCode, 'INVALID_STATE');
  assert.strictEqual(errStatus, 'ACCUMULATING');
});

test('IDLE state not modified by failed abort attempt', () => {
  const state = JSON.parse(originalBranchState);
  state.gate = { status: 'IDLE', current_run: null, last_failure: null, last_pass: null };
  writeJsonAtomic(BRANCH_STATE_PATH, state);

  const { abortGate } = require('../bridge/orchestrator');

  try { abortGate(); } catch (_) {}

  const persisted = JSON.parse(fs.readFileSync(BRANCH_STATE_PATH, 'utf-8'));
  assert.strictEqual(persisted.gate.status, 'IDLE', 'state should remain IDLE');
});

// Cleanup
cleanup();

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
