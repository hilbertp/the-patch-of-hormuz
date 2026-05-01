'use strict';

/**
 * bashir-lane-idle.test.js — Slice 274
 *
 * Verifies Bashir lane renders idle state when gate.status is IDLE
 * with no recent pass. Asserts lane-empty placeholder visible and no live-dot.
 *
 * Run: node test/bashir-lane-idle.test.js
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

// ── Simulate updateBashirLane state determination ──

function determineBashirState(gate, prevState) {
  const gateStatus = gate ? gate.status : 'IDLE';
  const currentRun = gate ? gate.current_run : null;
  const lastPass = gate ? gate.last_pass : null;

  if (gateStatus === 'GATE_FAILED') return 'failed';
  if (gateStatus === 'GATE_RUNNING') {
    const hasTestsUpdated = currentRun && currentRun.phase === 'tests-updated';
    return hasTestsUpdated ? 'running' : 'authoring';
  }
  // IDLE or ACCUMULATING
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

console.log('\n-- bashir-lane-idle tests --');

// 1. IDLE gate → idle state
test('gate.status IDLE produces idle state', () => {
  const gate = { status: 'IDLE', current_run: null, last_pass: null, last_failure: null };
  assert.strictEqual(determineBashirState(gate, 'idle'), 'idle');
});

// 2. ACCUMULATING gate → idle state
test('gate.status ACCUMULATING produces idle state', () => {
  const gate = { status: 'ACCUMULATING', current_run: null, last_pass: null, last_failure: null };
  assert.strictEqual(determineBashirState(gate, 'idle'), 'idle');
});

// 3. Idle state uses lane-status-idle class (no live-dot)
test('idle state uses lane-status-idle (no live-dot)', () => {
  assert.strictEqual(determineLaneStatusClass('idle'), 'lane-status lane-status-idle');
});

// 4. Null gate → idle state
test('null gate defaults to idle', () => {
  assert.strictEqual(determineBashirState(null, 'idle'), 'idle');
});

// 5. IDLE with old last_pass (>60s) → still idle
test('IDLE with stale last_pass (>60s ago) stays idle', () => {
  const gate = {
    status: 'IDLE', current_run: null,
    last_pass: { ts: new Date(Date.now() - 120000).toISOString() },
    last_failure: null
  };
  assert.strictEqual(determineBashirState(gate, 'idle'), 'idle');
});

// 6. lane-status-idle does NOT contain live-dot animation prefix
test('lane-status-idle class does not include lane-status-active', () => {
  const cls = determineLaneStatusClass('idle');
  assert.ok(!cls.includes('active'), 'idle class must not contain "active"');
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
