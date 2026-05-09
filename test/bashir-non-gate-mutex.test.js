'use strict';

/**
 * bashir-non-gate-mutex.test.js — Slice 299
 *
 * Tests that the Bashir mutex is shared between gate and non-gate paths:
 *   1. acquireGateMutex succeeds when no mutex held
 *   2. Second acquire fails with already_held (gate blocks non-gate)
 *   3. Release + re-acquire works (non-gate after gate release)
 *   4. shouldDeferSquash returns true when mutex held
 *
 * Run: node test/bashir-non-gate-mutex.test.js
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
// Load modules
// ---------------------------------------------------------------------------

const gateMutex = require('../bridge/state/gate-mutex');
const telemetry = require('../bridge/state/gate-telemetry');

const MUTEX_PATH = gateMutex.MUTEX_PATH;
const TEST_REGISTER = path.resolve(__dirname, '..', 'bridge', 'state', 'test-register-nongatemutex.jsonl');

// Point telemetry at test-local register
telemetry.setRegisterPath(TEST_REGISTER);

const noopCtx = {
  registerEvent: () => {},
  log: () => {},
};

function cleanup() {
  try { fs.unlinkSync(MUTEX_PATH); } catch (_) {}
  try { fs.unlinkSync(TEST_REGISTER); } catch (_) {}
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

console.log('\nbashir-non-gate-mutex.test.js');
console.log('\u2500'.repeat(50));

// Start clean
cleanup();

test('gate acquire succeeds when no mutex held', () => {
  cleanup();
  const result = gateMutex.acquireGateMutex('sha-gate', null, 'bridge/state/bashir-heartbeat.json', noopCtx);
  assert.strictEqual(result.ok, true, 'Should acquire successfully');
  assert.ok(fs.existsSync(MUTEX_PATH), 'Mutex file should exist');
});

test('non-gate acquire fails when gate mutex is held (shared mutex)', () => {
  // Mutex is still held from previous test
  const result = gateMutex.acquireGateMutex(null, null, 'bridge/state/bashir-heartbeat.json', noopCtx);
  assert.strictEqual(result.ok, false, 'Should fail to acquire');
  assert.strictEqual(result.reason, 'already_held', 'Reason should be already_held');
});

test('shouldDeferSquash returns true when mutex held', () => {
  // Mutex still held
  assert.strictEqual(gateMutex.shouldDeferSquash(), true, 'Should defer squash when mutex is held');
});

test('release then non-gate acquire succeeds', () => {
  gateMutex.releaseGateMutex('bashir_non_gate_complete', noopCtx);
  assert.ok(!fs.existsSync(MUTEX_PATH), 'Mutex file should be removed after release');

  // Now non-gate acquire should work
  const result = gateMutex.acquireGateMutex(null, null, 'bridge/state/bashir-heartbeat.json', noopCtx);
  assert.strictEqual(result.ok, true, 'Should acquire after release');

  // Clean up
  gateMutex.releaseGateMutex('test_cleanup', noopCtx);
});

test('shouldDeferSquash returns false when mutex not held', () => {
  assert.strictEqual(gateMutex.shouldDeferSquash(), false, 'Should not defer squash when no mutex');
});

test('concurrent gate + non-gate: second waits (acquire fails)', () => {
  cleanup();

  // Simulate gate holding mutex
  const gateResult = gateMutex.acquireGateMutex('sha-gate-2', 12345, 'bridge/state/bashir-heartbeat.json', noopCtx);
  assert.strictEqual(gateResult.ok, true, 'Gate should acquire');

  // Non-gate attempt should fail
  const nonGateResult = gateMutex.acquireGateMutex(null, null, 'bridge/state/bashir-heartbeat.json', noopCtx);
  assert.strictEqual(nonGateResult.ok, false, 'Non-gate should fail while gate holds mutex');
  assert.strictEqual(nonGateResult.reason, 'already_held');

  // After gate releases, non-gate can proceed
  gateMutex.releaseGateMutex('regression_pass', noopCtx);
  const retryResult = gateMutex.acquireGateMutex(null, null, 'bridge/state/bashir-heartbeat.json', noopCtx);
  assert.strictEqual(retryResult.ok, true, 'Non-gate should succeed after gate release');

  cleanup();
});

// ---------------------------------------------------------------------------
// Cleanup + report
// ---------------------------------------------------------------------------

cleanup();

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
