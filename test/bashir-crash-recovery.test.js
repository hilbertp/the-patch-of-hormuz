'use strict';

/**
 * bashir-crash-recovery.test.js — Slice 267
 *
 * Tests that the orchestrator handles Bashir crashes correctly:
 *   1. _gateAbort emits gate-abort event with reason
 *   2. _gateAbort sets branch-state.gate.status to GATE_ABORTED
 *   3. _gateAbort releases the mutex
 *   4. Abort reasons: heartbeat_stale, bashir_crash, timeout, no_tests_updated
 *
 * Run: node test/bashir-crash-recovery.test.js
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
const MUTEX_PATH = path.resolve(__dirname, '..', 'bridge', 'state', 'gate-running.json');
const TEST_REGISTER = path.resolve(__dirname, '..', 'bridge', 'state', 'test-register-267-cr.jsonl');

const telemetry = require('../bridge/state/gate-telemetry');
telemetry.setRegisterPath(TEST_REGISTER);

const { writeJsonAtomic } = require('../bridge/state/atomic-write');

const originalBranchState = fs.readFileSync(BRANCH_STATE_PATH, 'utf-8');

function readTelemetryEvents() {
  try {
    return fs.readFileSync(TEST_REGISTER, 'utf-8')
      .trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  } catch (_) { return []; }
}

function cleanup() {
  try { fs.unlinkSync(MUTEX_PATH); } catch (_) {}
  try { fs.unlinkSync(TEST_REGISTER); } catch (_) {}
  fs.writeFileSync(BRANCH_STATE_PATH, originalBranchState, 'utf-8');
}

function createMutex() {
  writeJsonAtomic(MUTEX_PATH, {
    schema_version: 1,
    started_ts: new Date().toISOString(),
    dev_tip_sha: 'crash-test-sha',
    bashir_pid: 12345,
    bashir_heartbeat_path: 'bridge/state/bashir-heartbeat.json',
  });
}

// ---------------------------------------------------------------------------
// Load module under test
// ---------------------------------------------------------------------------

const orchestrator = require('../bridge/orchestrator');

const ctx = {
  registerEvent: () => {},
  log: () => {},
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

console.log('\nbashir-crash-recovery.test.js');
console.log('─'.repeat(50));

test('_gateAbort emits gate-abort with reason heartbeat_stale', () => {
  cleanup();
  createMutex();

  orchestrator._gateAbort('crash-test-sha', 'heartbeat_stale', ctx);

  const events = readTelemetryEvents();
  const abortEvent = events.find(e => e.event === 'gate-abort');
  assert.ok(abortEvent, 'Should emit gate-abort');
  assert.strictEqual(abortEvent.reason, 'heartbeat_stale');
  assert.strictEqual(abortEvent.dev_tip_sha, 'crash-test-sha');
});

test('_gateAbort emits gate-abort with reason bashir_crash', () => {
  cleanup();
  createMutex();

  orchestrator._gateAbort('sha2', 'bashir_crash', ctx);

  const events = readTelemetryEvents();
  const abortEvent = events.find(e => e.event === 'gate-abort');
  assert.ok(abortEvent, 'Should emit gate-abort');
  assert.strictEqual(abortEvent.reason, 'bashir_crash');
});

test('_gateAbort emits gate-abort with reason timeout', () => {
  cleanup();
  createMutex();

  orchestrator._gateAbort('sha3', 'timeout', ctx);

  const events = readTelemetryEvents();
  const abortEvent = events.find(e => e.event === 'gate-abort');
  assert.ok(abortEvent, 'Should emit gate-abort');
  assert.strictEqual(abortEvent.reason, 'timeout');
});

test('_gateAbort sets branch-state to GATE_ABORTED', () => {
  cleanup();
  createMutex();

  orchestrator._gateAbort('crash-test-sha', 'heartbeat_stale', ctx);

  const state = JSON.parse(fs.readFileSync(BRANCH_STATE_PATH, 'utf-8'));
  assert.strictEqual(state.gate.status, 'GATE_ABORTED', 'Gate status should be GATE_ABORTED');
  assert.strictEqual(state.gate.current_run, null, 'current_run should be null');
});

test('_gateAbort releases the mutex', () => {
  cleanup();
  createMutex();

  orchestrator._gateAbort('crash-test-sha', 'timeout', ctx);

  assert.ok(!fs.existsSync(MUTEX_PATH), 'Mutex file should be deleted after abort');
});

test('_gateAbort with reason no_tests_updated', () => {
  cleanup();
  createMutex();

  orchestrator._gateAbort('sha4', 'no_tests_updated', ctx);

  const events = readTelemetryEvents();
  const abortEvent = events.find(e => e.event === 'gate-abort');
  assert.ok(abortEvent, 'Should emit gate-abort');
  assert.strictEqual(abortEvent.reason, 'no_tests_updated');
});

test('gate-abort events route through gate-telemetry.emit (not direct register writes)', () => {
  cleanup();
  createMutex();

  orchestrator._gateAbort('sha5', 'bashir_crash', ctx);

  // Verify events are in our telemetry register (not a separate register)
  const events = readTelemetryEvents();
  assert.ok(events.length > 0, 'Events should be written to telemetry register');
  const abortEvent = events.find(e => e.event === 'gate-abort');
  assert.ok(abortEvent, 'gate-abort should be in telemetry register');
});

// ---------------------------------------------------------------------------
// Cleanup + report
// ---------------------------------------------------------------------------

cleanup();

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
