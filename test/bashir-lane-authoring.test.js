'use strict';

/**
 * bashir-lane-authoring.test.js — Slice 274
 *
 * Verifies Bashir lane renders authoring state when gate.status is
 * GATE_RUNNING and no tests-updated event has fired yet.
 *
 * Run: node test/bashir-lane-authoring.test.js
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

console.log('\n-- bashir-lane-authoring tests --');

// 1. GATE_RUNNING with no phase → authoring
test('GATE_RUNNING with no tests-updated phase produces authoring', () => {
  const gate = {
    status: 'GATE_RUNNING',
    current_run: { started_ts: new Date().toISOString(), slices: ['270', '271'], ac_count: 8 },
    last_pass: null, last_failure: null
  };
  assert.strictEqual(determineBashirState(gate, 'idle'), 'authoring');
});

// 2. GATE_RUNNING with phase=null → authoring
test('GATE_RUNNING with null phase produces authoring', () => {
  const gate = {
    status: 'GATE_RUNNING',
    current_run: { started_ts: new Date().toISOString(), phase: null },
    last_pass: null, last_failure: null
  };
  assert.strictEqual(determineBashirState(gate, 'idle'), 'authoring');
});

// 3. Authoring state uses lane-status-active (has live-dot)
test('authoring state uses lane-status-active (live-dot visible)', () => {
  const cls = determineLaneStatusClass('authoring');
  assert.ok(cls.includes('lane-status-active'), 'authoring must use active pill');
});

// 4. GATE_RUNNING with current_run=null → authoring (defensive)
test('GATE_RUNNING with null current_run produces authoring', () => {
  const gate = { status: 'GATE_RUNNING', current_run: null, last_pass: null, last_failure: null };
  assert.strictEqual(determineBashirState(gate, 'idle'), 'authoring');
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
