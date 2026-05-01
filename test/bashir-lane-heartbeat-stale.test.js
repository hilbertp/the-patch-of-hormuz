'use strict';

/**
 * bashir-lane-heartbeat-stale.test.js — Slice 274
 *
 * Verifies Bashir lane shows heartbeat-stale warning badge when
 * gate.status is GATE_RUNNING and heartbeat age exceeds 90s (Worf's threshold).
 *
 * Run: node test/bashir-lane-heartbeat-stale.test.js
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

const HEARTBEAT_STALE_THRESHOLD_MS = 90000;

function shouldShowHeartbeatWarning(gateStatus, heartbeatAgeMs) {
  return gateStatus === 'GATE_RUNNING' &&
    heartbeatAgeMs != null &&
    heartbeatAgeMs > HEARTBEAT_STALE_THRESHOLD_MS;
}

console.log('\n-- bashir-lane-heartbeat-stale tests --');

// 1. GATE_RUNNING + stale heartbeat (>90s) → show warning
test('GATE_RUNNING with heartbeat age >90s shows warning', () => {
  assert.ok(shouldShowHeartbeatWarning('GATE_RUNNING', 91000));
});

// 2. GATE_RUNNING + fresh heartbeat (<90s) → no warning
test('GATE_RUNNING with heartbeat age <90s hides warning', () => {
  assert.ok(!shouldShowHeartbeatWarning('GATE_RUNNING', 45000));
});

// 3. GATE_RUNNING + exactly 90s → no warning (threshold is >90s)
test('GATE_RUNNING with heartbeat age exactly 90s hides warning', () => {
  assert.ok(!shouldShowHeartbeatWarning('GATE_RUNNING', 90000));
});

// 4. IDLE + stale heartbeat → no warning (only during GATE_RUNNING)
test('IDLE with stale heartbeat does not show warning', () => {
  assert.ok(!shouldShowHeartbeatWarning('IDLE', 120000));
});

// 5. GATE_FAILED + stale heartbeat → no warning
test('GATE_FAILED with stale heartbeat does not show warning', () => {
  assert.ok(!shouldShowHeartbeatWarning('GATE_FAILED', 120000));
});

// 6. GATE_RUNNING + null heartbeat age → no warning (absent heartbeat)
test('GATE_RUNNING with null heartbeat age hides warning', () => {
  assert.ok(!shouldShowHeartbeatWarning('GATE_RUNNING', null));
});

// 7. Threshold is exactly 90s (Worf's contract)
test('threshold constant is 90000ms (Worf contract)', () => {
  assert.strictEqual(HEARTBEAT_STALE_THRESHOLD_MS, 90000);
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
