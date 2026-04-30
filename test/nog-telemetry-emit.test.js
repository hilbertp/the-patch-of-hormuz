'use strict';

/**
 * nog-telemetry-emit.test.js — Slice 270
 *
 * Simulates Nog ACCEPTED on a slice with known parameters and verifies
 * the NOG_TELEMETRY event is emitted with correct payload via
 * gate-telemetry.emit().
 *
 * Run: node test/nog-telemetry-emit.test.js
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const { emit, setRegisterPath, VALID_EVENTS } = require('../bridge/state/gate-telemetry');

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
    if (err.stack) console.log(`    ${err.stack.split('\n').slice(1, 3).join('\n    ')}`);
  }
}

const TEST_DIR = fs.mkdtempSync(path.join(require('os').tmpdir(), 'nog-tel-'));
const REGISTER_PATH = path.join(TEST_DIR, 'register.jsonl');

function cleanup() {
  try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch (_) {}
}

console.log('\n-- nog-telemetry-emit tests --');

// ---------------------------------------------------------------------------
// 1. NOG_TELEMETRY is a valid event
// ---------------------------------------------------------------------------
test('NOG_TELEMETRY is in VALID_EVENTS', () => {
  assert.ok(VALID_EVENTS.has('NOG_TELEMETRY'), 'NOG_TELEMETRY must be in VALID_EVENTS');
});

// ---------------------------------------------------------------------------
// 2. Emit NOG_TELEMETRY with expected payload
// ---------------------------------------------------------------------------
test('emit NOG_TELEMETRY writes correct payload to register', () => {
  fs.writeFileSync(REGISTER_PATH, '');
  setRegisterPath(REGISTER_PATH);

  const payload = {
    slice_id: '042',
    rounds: 2,
    files_touched: ['bridge/orchestrator.js', 'dashboard/lcars-dashboard.html'],
    high_risk_surface: true,
    lint_findings_total: 1,
    ac_count: 3,
    escalated: false,
  };

  emit('NOG_TELEMETRY', payload);

  const lines = fs.readFileSync(REGISTER_PATH, 'utf-8').trim().split('\n');
  assert.strictEqual(lines.length, 1, 'Expected exactly one register line');

  const entry = JSON.parse(lines[0]);
  assert.strictEqual(entry.event, 'NOG_TELEMETRY');
  assert.strictEqual(entry.slice_id, '042');
  assert.strictEqual(entry.rounds, 2);
  assert.deepStrictEqual(entry.files_touched, ['bridge/orchestrator.js', 'dashboard/lcars-dashboard.html']);
  assert.strictEqual(entry.high_risk_surface, true, 'high_risk_surface should be true when orchestrator.js is touched');
  assert.strictEqual(entry.lint_findings_total, 1);
  assert.strictEqual(entry.ac_count, 3);
  assert.strictEqual(entry.escalated, false);
  assert.ok(entry.ts, 'Entry should have a timestamp');
});

// ---------------------------------------------------------------------------
// 3. Emission failure does not throw
// ---------------------------------------------------------------------------
test('NOG_TELEMETRY emission to bad path does not throw', () => {
  setRegisterPath('/nonexistent/path/register.jsonl');

  // Should not throw — gate-telemetry swallows write errors
  assert.doesNotThrow(() => {
    emit('NOG_TELEMETRY', { slice_id: '099', rounds: 1 });
  });

  // Reset for other tests
  setRegisterPath(REGISTER_PATH);
});

cleanup();

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
