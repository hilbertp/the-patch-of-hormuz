'use strict';

/**
 * bashir-lane-passed.test.js — Slice 274
 *
 * Verifies Bashir lane renders gate-passed state when gate.status returns
 * to IDLE with a recent last_pass.ts (< 60s). After 5s the lane should
 * logically fade to idle.
 *
 * Run: node test/bashir-lane-passed.test.js
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

console.log('\n-- bashir-lane-passed tests --');

// 1. IDLE with recent last_pass and previous state=running → passed
test('IDLE with recent last_pass (< 60s) and prevState=running → passed', () => {
  const gate = {
    status: 'IDLE', current_run: null,
    last_pass: { ts: new Date(Date.now() - 2000).toISOString() },
    last_failure: null
  };
  assert.strictEqual(determineBashirState(gate, 'running'), 'passed');
});

// 2. passed state uses lane-status-active
test('passed state uses lane-status-active', () => {
  const cls = determineLaneStatusClass('passed');
  assert.ok(cls.includes('lane-status-active'));
});

// 3. After "fade" (simulated: prevState is now idle), same gate → idle
test('after fade to idle, same recent pass gate → idle (prevState=idle)', () => {
  const gate = {
    status: 'IDLE', current_run: null,
    last_pass: { ts: new Date(Date.now() - 3000).toISOString() },
    last_failure: null
  };
  assert.strictEqual(determineBashirState(gate, 'idle'), 'idle');
});

// 4. IDLE with old last_pass (>60s) and prevState=running → idle (not passed)
test('IDLE with stale last_pass (>60s) and prevState=running → idle', () => {
  const gate = {
    status: 'IDLE', current_run: null,
    last_pass: { ts: new Date(Date.now() - 90000).toISOString() },
    last_failure: null
  };
  assert.strictEqual(determineBashirState(gate, 'running'), 'idle');
});

// 5. Fade timer: passed → idle after conceptual 5s
test('passed eventually fades to idle (prevState becomes idle)', () => {
  const gate = {
    status: 'IDLE', current_run: null,
    last_pass: { ts: new Date(Date.now() - 4000).toISOString() },
    last_failure: null
  };
  // First call from running → passed
  const s1 = determineBashirState(gate, 'running');
  assert.strictEqual(s1, 'passed');
  // After fade timer fires, prevState = idle → idle
  const s2 = determineBashirState(gate, 'idle');
  assert.strictEqual(s2, 'idle');
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
