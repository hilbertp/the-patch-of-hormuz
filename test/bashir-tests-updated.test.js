'use strict';

/**
 * bashir-tests-updated.test.js — Slice 267
 *
 * Tests that the orchestrator transitions correctly when Bashir emits
 * the `tests-updated` event:
 *   1. _gateTestsUpdated emits regression-fail with reason suite-not-yet-executed
 *   2. _gateTestsUpdated sets branch-state.gate.status to GATE_FAILED
 *   3. _gateTestsUpdated releases the mutex
 *   4. _checkForEvent finds events after a given timestamp
 *
 * Run: node test/bashir-tests-updated.test.js
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
const REGISTER_PATH = path.resolve(__dirname, '..', 'bridge', 'register.jsonl');
const TEST_REGISTER = path.resolve(__dirname, '..', 'bridge', 'state', 'test-register-267-tu.jsonl');

const telemetry = require('../bridge/state/gate-telemetry');
telemetry.setRegisterPath(TEST_REGISTER);

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

// ---------------------------------------------------------------------------
// Load module under test
// ---------------------------------------------------------------------------

const orchestrator = require('../bridge/orchestrator');

// Stub registerEvent and log for ctx
const logEntries = [];
const ctx = {
  registerEvent: () => {},
  log: (level, event, fields) => { logEntries.push({ level, event, fields }); },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

console.log('\nbashir-tests-updated.test.js');
console.log('─'.repeat(50));

test('_gateTestsUpdated emits regression-fail via telemetry', () => {
  cleanup();

  // Pre-create mutex so release can find it
  const { writeJsonAtomic } = require('../bridge/state/atomic-write');
  writeJsonAtomic(MUTEX_PATH, {
    schema_version: 1,
    started_ts: new Date().toISOString(),
    dev_tip_sha: 'test123',
    bashir_pid: null,
    bashir_heartbeat_path: null,
  });

  // Set branch-state to GATE_RUNNING
  const state = JSON.parse(originalBranchState);
  state.gate = { status: 'GATE_RUNNING', current_run: { started_ts: new Date().toISOString() } };
  writeJsonAtomic(BRANCH_STATE_PATH, state);

  orchestrator._gateTestsUpdated('test123', ctx);

  const events = readTelemetryEvents();
  const failEvent = events.find(e => e.event === 'regression-fail');
  assert.ok(failEvent, 'Should emit regression-fail');
  assert.strictEqual(failEvent.reason, 'suite-not-yet-executed', 'Reason should be suite-not-yet-executed');
});

test('_gateTestsUpdated sets branch-state to GATE_FAILED', () => {
  cleanup();

  const { writeJsonAtomic } = require('../bridge/state/atomic-write');
  writeJsonAtomic(MUTEX_PATH, {
    schema_version: 1,
    started_ts: new Date().toISOString(),
    dev_tip_sha: 'test123',
  });

  orchestrator._gateTestsUpdated('test123', ctx);

  const state = JSON.parse(fs.readFileSync(BRANCH_STATE_PATH, 'utf-8'));
  assert.strictEqual(state.gate.status, 'GATE_FAILED', 'Gate status should be GATE_FAILED');
  assert.strictEqual(state.gate.current_run, null, 'current_run should be null');
  assert.ok(state.gate.last_failure, 'last_failure should be set');
  assert.strictEqual(state.gate.last_failure.dev_tip_sha, 'test123');
});

test('_gateTestsUpdated releases the mutex', () => {
  cleanup();

  const { writeJsonAtomic } = require('../bridge/state/atomic-write');
  writeJsonAtomic(MUTEX_PATH, {
    schema_version: 1,
    started_ts: new Date().toISOString(),
    dev_tip_sha: 'test123',
  });

  orchestrator._gateTestsUpdated('test123', ctx);

  assert.ok(!fs.existsSync(MUTEX_PATH), 'Mutex file should be deleted');
});

test('_checkForEvent finds matching event after timestamp', () => {
  cleanup();

  const beforeTs = new Date().toISOString();

  // Write a test event to the test register
  telemetry.emit('tests-updated', { suite_size: 5, tests_added: 3, tests_updated: 0 });

  // Point _checkForEvent at our test register — it reads from bridge/register.jsonl by default
  // We need to write to the actual register path for this test
  const actualRegister = path.resolve(__dirname, '..', 'bridge', 'register.jsonl');
  let originalRegister = '';
  try { originalRegister = fs.readFileSync(actualRegister, 'utf-8'); } catch (_) {}

  // Append a tests-updated event
  const entry = JSON.stringify({ ts: new Date().toISOString(), event: 'tests-updated', suite_size: 5 });
  fs.appendFileSync(actualRegister, entry + '\n');

  const found = orchestrator._checkForEvent('tests-updated', beforeTs);
  assert.ok(found, 'Should find the event');
  assert.strictEqual(found.event, 'tests-updated');

  // Restore register
  fs.writeFileSync(actualRegister, originalRegister, 'utf-8');
});

test('_checkForEvent returns null for non-matching event', () => {
  cleanup();

  const futureTs = '2099-01-01T00:00:00.000Z';
  const found = orchestrator._checkForEvent('tests-updated', futureTs);
  assert.strictEqual(found, null, 'Should return null for future timestamp');
});

// ---------------------------------------------------------------------------
// Cleanup + report
// ---------------------------------------------------------------------------

cleanup();

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
