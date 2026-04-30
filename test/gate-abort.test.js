'use strict';

/**
 * gate-abort.test.js — Slice 271
 *
 * Verifies that abortGate():
 *   1. Transitions gate.status from GATE_FAILED → ACCUMULATING
 *   2. Emits gate-abort telemetry with reason "user-abort"
 *   3. Preserves gate.last_failure (audit trail)
 *   4. Clears current_run
 *
 * Run: node test/gate-abort.test.js
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
const TEST_REGISTER = path.resolve(__dirname, '..', 'bridge', 'state', 'test-register-271-abort.jsonl');

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
  try { fs.unlinkSync(TEST_REGISTER); } catch (_) {}
  try { fs.unlinkSync(MUTEX_PATH); } catch (_) {}
  fs.writeFileSync(BRANCH_STATE_PATH, originalBranchState, 'utf-8');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

console.log('\ngate-abort.test.js (slice 271)\n');

// Test 1: GATE_FAILED → ACCUMULATING
test('abortGate transitions GATE_FAILED to ACCUMULATING', () => {
  cleanup();

  const failedAcs = [
    { slice_id: '100', ac_index: 1, test_path: 'test-100-ac-1', failure_excerpt: 'Expected X got Y' },
  ];
  const state = JSON.parse(originalBranchState);
  state.gate = {
    status: 'GATE_FAILED',
    current_run: null,
    last_failure: { ts: '2026-04-29T10:00:00Z', dev_tip_sha: 'abc123', failed_acs: failedAcs },
    last_pass: null,
  };
  writeJsonAtomic(BRANCH_STATE_PATH, state);

  // Clear delete stale events
  try { fs.unlinkSync(TEST_REGISTER); } catch (_) {}

  const { abortGate } = require('../bridge/orchestrator');
  const result = abortGate();

  assert.strictEqual(result.status, 'ACCUMULATING', 'gate.status should be ACCUMULATING');
  assert.strictEqual(result.current_run, null, 'current_run should be null');

  // Verify last_failure preserved
  assert.ok(result.last_failure, 'last_failure should be preserved');
  assert.strictEqual(result.last_failure.dev_tip_sha, 'abc123');
  assert.strictEqual(result.last_failure.failed_acs.length, 1);
  assert.strictEqual(result.last_failure.failed_acs[0].slice_id, '100');

  // Verify telemetry
  const events = readTelemetryEvents();
  const abortEvent = events.find(e => e.event === 'gate-abort');
  assert.ok(abortEvent, 'gate-abort event should be emitted');
  assert.strictEqual(abortEvent.reason, 'user-abort');
});

// Test 2: GATE_ABORTED → ACCUMULATING (also valid)
test('abortGate transitions GATE_ABORTED to ACCUMULATING', () => {
  cleanup();

  const state = JSON.parse(originalBranchState);
  state.gate = {
    status: 'GATE_ABORTED',
    current_run: null,
    last_failure: { ts: '2026-04-29T10:00:00Z', dev_tip_sha: 'def456', failed_acs: [] },
    last_pass: null,
  };
  writeJsonAtomic(BRANCH_STATE_PATH, state);

  try { fs.unlinkSync(TEST_REGISTER); } catch (_) {}

  const { abortGate } = require('../bridge/orchestrator');
  const result = abortGate();

  assert.strictEqual(result.status, 'ACCUMULATING');
});

// Test 3: Defensive mutex cleanup
test('abortGate releases orphaned mutex defensively', () => {
  cleanup();

  const state = JSON.parse(originalBranchState);
  state.gate = { status: 'GATE_FAILED', current_run: null, last_failure: null, last_pass: null };
  writeJsonAtomic(BRANCH_STATE_PATH, state);

  // Plant an orphaned mutex
  writeJsonAtomic(MUTEX_PATH, { schema_version: 1, started_ts: '2026-04-29T10:00:00Z', dev_tip_sha: 'orphan' });

  try { fs.unlinkSync(TEST_REGISTER); } catch (_) {}

  const { abortGate } = require('../bridge/orchestrator');
  abortGate();

  // Mutex should be gone
  assert.ok(!fs.existsSync(MUTEX_PATH), 'gate-running.json should be removed');
});

// Test 4: Verify on-disk state matches
test('abortGate persists ACCUMULATING to disk', () => {
  cleanup();

  const state = JSON.parse(originalBranchState);
  state.gate = { status: 'GATE_FAILED', current_run: null, last_failure: null, last_pass: null };
  writeJsonAtomic(BRANCH_STATE_PATH, state);

  try { fs.unlinkSync(TEST_REGISTER); } catch (_) {}

  const { abortGate } = require('../bridge/orchestrator');
  abortGate();

  const persisted = JSON.parse(fs.readFileSync(BRANCH_STATE_PATH, 'utf-8'));
  assert.strictEqual(persisted.gate.status, 'ACCUMULATING');
});

// Cleanup
cleanup();

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
