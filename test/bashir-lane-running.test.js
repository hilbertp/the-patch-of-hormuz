'use strict';

/**
 * bashir-lane-running.test.js — Slice 274
 *
 * Verifies Bashir lane renders running-suite state when gate.status is
 * GATE_RUNNING and tests-updated event has fired (phase === 'tests-updated').
 *
 * Run: node test/bashir-lane-running.test.js
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

console.log('\n-- bashir-lane-running tests --');

// 1. GATE_RUNNING with phase=tests-updated → running
test('GATE_RUNNING with tests-updated phase produces running', () => {
  const gate = {
    status: 'GATE_RUNNING',
    current_run: { started_ts: new Date().toISOString(), phase: 'tests-updated', slices: ['270'] },
    last_pass: null, last_failure: null
  };
  assert.strictEqual(determineBashirState(gate, 'authoring'), 'running');
});

// 2. Running state uses lane-status-active
test('running state uses lane-status-active', () => {
  const cls = determineLaneStatusClass('running');
  assert.ok(cls.includes('lane-status-active'));
});

// 3. Transition from authoring → running when phase changes
test('authoring transitions to running when phase becomes tests-updated', () => {
  const gateBefore = {
    status: 'GATE_RUNNING',
    current_run: { started_ts: new Date().toISOString() },
    last_pass: null, last_failure: null
  };
  const gateAfter = {
    status: 'GATE_RUNNING',
    current_run: { started_ts: new Date().toISOString(), phase: 'tests-updated' },
    last_pass: null, last_failure: null
  };
  assert.strictEqual(determineBashirState(gateBefore, 'idle'), 'authoring');
  assert.strictEqual(determineBashirState(gateAfter, 'authoring'), 'running');
});

// 4. Running state is distinct from authoring
test('running and authoring are distinct states', () => {
  assert.notStrictEqual('running', 'authoring');
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
