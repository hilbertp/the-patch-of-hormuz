'use strict';

/**
 * state-doctor.test.js
 *
 * Regression tests for bridge/state-doctor.js.
 * Uses synthetic state files in tmp fixtures — no real state touched.
 *
 * Tests:
 *   1. Happy-path summary renders all sections
 *   2. Anomaly: mutex present, no heartbeat
 *   3. Anomaly: mutex present, heartbeat stale
 *   4. Anomaly: gate RUNNING but no mutex
 *   5. Anomaly: main tip mismatch
 *   6. Anomaly: pause flag present
 *   7. Missing files handled gracefully (no crash, shows "(absent)")
 *   8. CLI exits 0
 *
 * Run: node test/state-doctor.test.js
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { execSync } = require('child_process');

const { detectAnomalies, render, ageMs, STALE_THRESHOLD_MS } = require('../bridge/state-doctor');

// ---------------------------------------------------------------------------
// Helpers to build synthetic state objects
// ---------------------------------------------------------------------------

function makeState(overrides = {}) {
  const now = new Date().toISOString();
  return {
    branchState: {
      data: {
        branch: { main: { tip_sha: 'abc12345' } },
        gate: { status: 'IDLE' }
      },
      exists: true,
      error: null
    },
    gateRunning: { data: null, exists: false, error: null },
    bashirHb: { data: null, exists: false, error: null },
    orchHb: {
      data: { ts: now, status: 'idle', current_slice: null, queue: { waiting: 0, active: 0, done: 5, error: 1 } },
      exists: true,
      error: null
    },
    runPid: { text: '12345', exists: true },
    pauseFlag: false,
    recentEvents: [],
    mainSha: 'abc12345',
    ...overrides
  };
}

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

console.log('\nstate-doctor.test.js\n');

// 1. Happy-path summary renders all sections
test('happy-path renders all sections', () => {
  const state = makeState();
  const anomalies = detectAnomalies(state);
  const output = render(state, anomalies);

  assert.ok(output.includes('--- Orchestrator ---'), 'missing Orchestrator section');
  assert.ok(output.includes('--- Bashir ---'), 'missing Bashir section');
  assert.ok(output.includes('--- Gate ---'), 'missing Gate section');
  assert.ok(output.includes('--- Pause Flag ---'), 'missing Pause Flag section');
  assert.ok(output.includes('--- Recent Events ---'), 'missing Recent Events section');
  assert.ok(output.includes('--- Anomalies ---'), 'missing Anomalies section');
  assert.ok(output.includes('None detected'), 'should show no anomalies in happy path');
});

// 2. Anomaly: mutex present, no heartbeat
test('anomaly: mutex present but no heartbeat', () => {
  const state = makeState({
    gateRunning: {
      data: { started_at: new Date().toISOString(), slice_id: '100' },
      exists: true,
      error: null
    },
    bashirHb: { data: null, exists: false, error: null }
  });
  const anomalies = detectAnomalies(state);
  const ids = anomalies.map(a => a.id);
  assert.ok(ids.includes('mutex-no-heartbeat'), 'should flag mutex-no-heartbeat');
});

// 3. Anomaly: mutex present, heartbeat stale
test('anomaly: mutex present but heartbeat stale', () => {
  const staleTs = new Date(Date.now() - STALE_THRESHOLD_MS - 60_000).toISOString();
  const state = makeState({
    gateRunning: {
      data: { started_at: new Date().toISOString(), slice_id: '100' },
      exists: true,
      error: null
    },
    bashirHb: {
      data: { ts: staleTs, slice_id: '100' },
      exists: true,
      error: null
    }
  });
  const anomalies = detectAnomalies(state);
  const ids = anomalies.map(a => a.id);
  assert.ok(ids.includes('mutex-heartbeat-stale'), 'should flag mutex-heartbeat-stale');
});

// 4. Anomaly: gate RUNNING but no mutex
test('anomaly: gate RUNNING but no mutex', () => {
  const state = makeState({
    branchState: {
      data: {
        branch: { main: { tip_sha: 'abc12345' } },
        gate: { status: 'GATE_RUNNING', slice_id: '100' }
      },
      exists: true,
      error: null
    },
    gateRunning: { data: null, exists: false, error: null }
  });
  const anomalies = detectAnomalies(state);
  const ids = anomalies.map(a => a.id);
  assert.ok(ids.includes('gate-running-no-mutex'), 'should flag gate-running-no-mutex');
});

// 5. Anomaly: main tip mismatch
test('anomaly: main tip mismatch with git', () => {
  const state = makeState({
    branchState: {
      data: {
        branch: { main: { tip_sha: 'aaaa1111' } },
        gate: { status: 'IDLE' }
      },
      exists: true,
      error: null
    },
    mainSha: 'bbbb2222'
  });
  const anomalies = detectAnomalies(state);
  const ids = anomalies.map(a => a.id);
  assert.ok(ids.includes('main-tip-mismatch'), 'should flag main-tip-mismatch');
});

// 6. Anomaly: pause flag present
test('anomaly: pause flag present', () => {
  const state = makeState({ pauseFlag: true });
  const anomalies = detectAnomalies(state);
  const ids = anomalies.map(a => a.id);
  assert.ok(ids.includes('pause-flag-present'), 'should flag pause-flag-present');
});

// 7. Missing files handled gracefully
test('missing files render (absent) without crash', () => {
  const state = makeState({
    branchState: { data: null, exists: false, error: null },
    gateRunning: { data: null, exists: false, error: null },
    bashirHb: { data: null, exists: false, error: null },
    orchHb: { data: null, exists: false, error: null },
    runPid: { text: null, exists: false },
    pauseFlag: false,
    recentEvents: [],
    mainSha: null
  });
  const anomalies = detectAnomalies(state);
  const output = render(state, anomalies);

  assert.ok(output.includes('(absent)'), 'should show (absent) for missing files');
  // Should not throw — reaching here means no crash
});

// 8. CLI exits 0
test('CLI exits 0 when run directly', () => {
  const doctorPath = path.join(__dirname, '..', 'bridge', 'state-doctor.js');
  // Run in a subshell; it will read real (probably missing) state files
  // but should not crash
  const result = execSync(`node "${doctorPath}"`, {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe']
  });
  assert.ok(result.includes('STATE DOCTOR'), 'should print STATE DOCTOR header');
});

// 9. No anomalies in clean happy path
test('no anomalies in clean state', () => {
  const state = makeState();
  const anomalies = detectAnomalies(state);
  assert.strictEqual(anomalies.length, 0, 'clean state should have zero anomalies');
});

// 10. Multiple anomalies can fire simultaneously
test('multiple anomalies fire together', () => {
  const staleTs = new Date(Date.now() - STALE_THRESHOLD_MS - 60_000).toISOString();
  const state = makeState({
    branchState: {
      data: {
        branch: { main: { tip_sha: 'aaaa1111' } },
        gate: { status: 'GATE_RUNNING' }
      },
      exists: true,
      error: null
    },
    gateRunning: {
      data: { started_at: new Date().toISOString() },
      exists: true,
      error: null
    },
    bashirHb: {
      data: { ts: staleTs },
      exists: true,
      error: null
    },
    pauseFlag: true,
    mainSha: 'bbbb2222'
  });
  const anomalies = detectAnomalies(state);
  const ids = anomalies.map(a => a.id);
  assert.ok(ids.includes('mutex-heartbeat-stale'), 'should flag stale heartbeat');
  assert.ok(ids.includes('main-tip-mismatch'), 'should flag tip mismatch');
  assert.ok(ids.includes('pause-flag-present'), 'should flag pause');
  assert.ok(anomalies.length >= 3, `expected >= 3 anomalies, got ${anomalies.length}`);
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
