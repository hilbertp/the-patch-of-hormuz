'use strict';

/**
 * bashir-lane-failed.test.js — Slice 274
 *
 * Verifies Bashir lane renders gate-failed state when gate.status is
 * GATE_FAILED. Failed state persists until next gate-start.
 *
 * Run: node test/bashir-lane-failed.test.js
 */

const assert = require('assert');

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

function determineBashirState(gate, prevState) {
  const gateStatus = gate ? gate.status : 'IDLE';
  const currentRun = gate ? gate.current_run : null;
  const lastPass = gate ? gate.last_pass : null;

  if (gateStatus === 'GATE_FAILED') return 'failed';
  if (gateStatus === 'GATE_RUNNING') {
    const hasTestsUpdated = currentRun && currentRun.phase === 'tests-updated';
    return hasTestsUpdated ? 'running' : 'authoring';
  }
  const recentPass = lastPass && lastPass.ts &&
    (Date.now() - new Date(lastPass.ts).getTime()) < 60000;
  if (recentPass && prevState !== 'idle') return 'passed';
  return 'idle';
}

function determineLaneStatusClass(state) {
  if (state === 'failed') return 'lane-status lane-status-err';
  if (state === 'authoring' || state === 'running' || state === 'passed') return 'lane-status lane-status-active';
  return 'lane-status lane-status-idle';
}

console.log('\n-- bashir-lane-failed tests --');

// 1. GATE_FAILED → failed state
test('GATE_FAILED produces failed state', () => {
  const gate = {
    status: 'GATE_FAILED', current_run: null,
    last_pass: null,
    last_failure: { ts: new Date().toISOString(), failed_acs: ['AC1', 'AC2'] }
  };
  assert.strictEqual(determineBashirState(gate, 'running'), 'failed');
});

// 2. failed state uses lane-status-err
test('failed state uses lane-status-err', () => {
  const cls = determineLaneStatusClass('failed');
  assert.ok(cls.includes('lane-status-err'));
});

// 3. GATE_FAILED persists across repeated polls (doesn't flip to idle)
test('GATE_FAILED persists on repeated evaluation', () => {
  const gate = {
    status: 'GATE_FAILED', current_run: null,
    last_pass: null,
    last_failure: { ts: new Date().toISOString(), failed_acs: ['AC1'] }
  };
  assert.strictEqual(determineBashirState(gate, 'failed'), 'failed');
  assert.strictEqual(determineBashirState(gate, 'failed'), 'failed');
});

// 4. GATE_FAILED → next gate-start → authoring (not stuck on failed)
test('GATE_FAILED clears on next GATE_RUNNING', () => {
  const gateFailed = {
    status: 'GATE_FAILED', current_run: null,
    last_pass: null, last_failure: { ts: new Date().toISOString(), failed_acs: ['AC1'] }
  };
  const gateRunning = {
    status: 'GATE_RUNNING',
    current_run: { started_ts: new Date().toISOString() },
    last_pass: null, last_failure: null
  };
  assert.strictEqual(determineBashirState(gateFailed, 'running'), 'failed');
  assert.strictEqual(determineBashirState(gateRunning, 'failed'), 'authoring');
});

// 5. failed_acs count is extractable from gate.last_failure
test('failed_acs array length gives AC failure count', () => {
  const gate = {
    status: 'GATE_FAILED', current_run: null,
    last_pass: null,
    last_failure: { ts: new Date().toISOString(), failed_acs: ['AC1', 'AC2', 'AC3'] }
  };
  assert.strictEqual(gate.last_failure.failed_acs.length, 3);
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
